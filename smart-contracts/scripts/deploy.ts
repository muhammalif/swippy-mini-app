import { ethers, network } from "hardhat";
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface BaseAddresses {
  WETH: string;
  UNISWAP_V3_ROUTER: string;
  UNISWAP_V3_QUOTER: string;
}

interface BaseNetworkAddresses {
  base: BaseAddresses;
  baseSepolia: BaseAddresses;
}

interface ContractInfo {
  address: string;
  transactionHash: string;
  blockNumber: number | null;
}

interface DeploymentInfo {
  network: string;
  chainId: number | undefined;
  deployer: string;
  contracts: {
    CompensationPool: ContractInfo;
    PredictionRegistry: ContractInfo;
  };
  networkAddresses: BaseAddresses;
  deploymentTime: string;
  gasUsed: {
    CompensationPool: string;
    PredictionRegistry: string;
  };
}

// Contract addresses for Base Network
const BASE_ADDRESSES: BaseNetworkAddresses = {
  // Base Mainnet
  base: {
    WETH: "0x4200000000000000000000000000000000000006",
    UNISWAP_V3_ROUTER: "0x2626664c2603336E57B271c5C0b26F421741e481",
    UNISWAP_V3_QUOTER: "0x3e6c707d0125226ff60f291b6bd1404634f00aba",
  },
  // Base Sepolia
  baseSepolia: {
    WETH: "0x4200000000000000000000000000000000000006",
    UNISWAP_V3_ROUTER: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
    UNISWAP_V3_QUOTER: "0x3e6c707d0125226ff60f291b6bd1404634f00aba",
  }
};

async function main(): Promise<void> {
  console.log("🚀 Starting Swippy Mini App deployment...");
  console.log("Network:", network.name);
  
  const signers = await ethers.getSigners();
  console.log("Deployer:", signers[0].address);

  // Get network-specific addresses
  const networkAddresses: BaseAddresses = BASE_ADDRESSES[network.name as keyof typeof BASE_ADDRESSES] || BASE_ADDRESSES.baseSepolia;
  console.log("Using WETH address:", networkAddresses.WETH);

  // Deploy TimelockController
  console.log("\n📦 Deploying TimelockController...");
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const timelock = await TimelockController.deploy(0, [], [], signers[0].address);
  await timelock.waitForDeployment();
  await new Promise(resolve => setTimeout(resolve, 5000));
  const timelockAddress = await timelock.getAddress();
  console.log("✅ TimelockController deployed to:", timelockAddress);

   // Grant roles to deployer with error handling
   console.log("🔐 Granting roles to deployer...");
   try {
     const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
     const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
     await timelock.grantRole(PROPOSER_ROLE, signers[0].address);
     await timelock.grantRole(EXECUTOR_ROLE, signers[0].address);
     console.log("✅ Roles granted to deployer");
   } catch (error) {
     console.log("⚠️  Role calls failed, using default role hashes...");
     // Known role hashes from OpenZeppelin TimelockController
     const PROPOSER_ROLE = "0xb09aa5aeb3702cfd50b6b62bc4532604938f21248b85fe848bde38d31e0ad3346a";
     const EXECUTOR_ROLE = "0xd8aa0f3194971a2a116679f7a39564095af4836db595ccb2bb47bc0346f94e7a67";
     await timelock.grantRole(PROPOSER_ROLE, signers[0].address);
     await timelock.grantRole(EXECUTOR_ROLE, signers[0].address);
     console.log("✅ Roles granted using default hashes");
   }

  // Deploy CompensationPool first
  console.log("\n📦 Deploying CompensationPool...");
  const CompensationPool = await ethers.getContractFactory("CompensationPool");
  const compensationPool = await CompensationPool.deploy(networkAddresses.WETH);
  await compensationPool.waitForDeployment();

  const compensationPoolAddress = await compensationPool.getAddress();
  console.log("✅ CompensationPool deployed to:", compensationPoolAddress);

  // Set timelock in CompensationPool
  await compensationPool.setTimelock(timelockAddress);
  console.log("✅ Timelock set in CompensationPool");

  // Deploy PredictionRegistry
  console.log("\n📦 Deploying PredictionRegistry...");
  const PredictionRegistry = await ethers.getContractFactory("PredictionRegistry");
  const predictionRegistry = await PredictionRegistry.deploy(
    compensationPoolAddress,
    networkAddresses.WETH
  );
  await predictionRegistry.waitForDeployment();
  
  const predictionRegistryAddress = await predictionRegistry.getAddress();
  console.log("✅ PredictionRegistry deployed to:", predictionRegistryAddress);

   // Set registry address in CompensationPool (bypass timelock for deployment)
   console.log("\n🔗 Setting registry address in CompensationPool...");
   await compensationPool.executeSetRegistry(predictionRegistryAddress);
   console.log("✅ Registry address set successfully");

  // Get deployment info
  const deployer = signers[0];
  const deploymentInfo: DeploymentInfo = {
    network: network.name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    contracts: {
      CompensationPool: {
        address: compensationPoolAddress,
        transactionHash: compensationPool.deploymentTransaction()?.hash || "",
        blockNumber: compensationPool.deploymentTransaction()?.blockNumber || null
      },
      PredictionRegistry: {
        address: predictionRegistryAddress,
        transactionHash: predictionRegistry.deploymentTransaction()?.hash || "",
        blockNumber: predictionRegistry.deploymentTransaction()?.blockNumber || null
      }
    },
    networkAddresses: networkAddresses,
    deploymentTime: new Date().toISOString(),
    gasUsed: {
      CompensationPool: (await compensationPool.deploymentTransaction()?.wait())?.gasUsed.toString() || "0",
      PredictionRegistry: (await predictionRegistry.deploymentTransaction()?.wait())?.gasUsed.toString() || "0"
    }
  };

  console.log("\n📋 Deployment Summary:");
  console.log("=".repeat(50));
  console.log("Network:", deploymentInfo.network);
  console.log("Chain ID:", deploymentInfo.chainId);
  console.log("Deployer:", deploymentInfo.deployer);
  console.log("\nContract Addresses:");
  console.log("CompensationPool:", deploymentInfo.contracts.CompensationPool.address);
  console.log("PredictionRegistry:", deploymentInfo.contracts.PredictionRegistry.address);
  console.log("\nNetwork Addresses:");
  console.log("WETH:", networkAddresses.WETH);
  console.log("Uniswap V3 Router:", networkAddresses.UNISWAP_V3_ROUTER);
  console.log("Uniswap V3 Quoter:", networkAddresses.UNISWAP_V3_QUOTER);

  // Verify contracts on block explorer (if not localhost/hardhat)
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("\n🔍 Verifying contracts on block explorer...");
    
    try {
      // Wait for block confirmations
      console.log("Waiting for block confirmations...");
      await compensationPool.deploymentTransaction()?.wait(6);
      await predictionRegistry.deploymentTransaction()?.wait(6);

      // Verify CompensationPool
      console.log("Verifying CompensationPool...");
      await hre.run("verify:verify", {
        address: compensationPoolAddress,
        constructorArguments: [networkAddresses.WETH],
      });
      console.log("✅ CompensationPool verified");

      // Verify PredictionRegistry
      console.log("Verifying PredictionRegistry...");
      await hre.run("verify:verify", {
        address: predictionRegistryAddress,
        constructorArguments: [compensationPoolAddress, networkAddresses.WETH],
      });
      console.log("✅ PredictionRegistry verified");

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("❌ Verification failed:", errorMessage);
    }
  }

  // Save deployment info to file
  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n💾 Deployment info saved to: ${deploymentFile}`);

  // Display next steps
  console.log("\n🎯 Next Steps:");
  console.log("=".repeat(50));
  console.log("1. Update relayer address (if different from deployer):");
  console.log(`   await predictionRegistry.connect(owner).executeSetRelayer("RELAYER_ADDRESS");`);
  console.log("\n2. Update oracle address (replace MockAggregator with real Chainlink feed in production):");
  console.log(`   await predictionRegistry.setPriceFeed("REAL_ORACLE_ADDRESS");`);
  console.log("\n3. Deposit WETH to CompensationPool for rewards:");
  console.log(`   await compensationPool.depositWETH(ethers.parseEther("10"));`);
  console.log("\n4. Update frontend contract addresses");
  console.log("\n5. Test the contracts with frontend integration");

  console.log("\n🎉 Deployment completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
