import { network } from "hardhat";
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

interface DeploymentInfo {
  network: string;
  chainId: number | undefined;
  deployer: string;
  contracts: {
    CompensationPool: {
      address: string;
      transactionHash: string;
      blockNumber: number | null;
    };
    PredictionRegistry: {
      address: string;
      transactionHash: string;
      blockNumber: number | null;
    };
  };
  networkAddresses: BaseAddresses;
  deploymentTime: string;
}

async function verifyContract(
  address: string, 
  constructorArguments: unknown[], 
  contractName: string
): Promise<boolean> {
  try {
    console.log(`🔍 Verifying ${contractName} at ${address}...`);
    
    await hre.run("verify:verify", {
      address: address,
      constructorArguments: constructorArguments,
    });
    
    console.log(`✅ ${contractName} verified successfully`);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("Already Verified")) {
      console.log(`✅ ${contractName} already verified`);
      return true;
    } else {
      console.log(`❌ ${contractName} verification failed:`, errorMessage);
      return false;
    }
  }
}

async function main(): Promise<void> {
  console.log("🔍 Starting contract verification...");
  
  // Read deployment info
  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  const networkName = network.name;
  const deploymentFile = path.join(deploymentsDir, `${networkName}.json`);
  
  if (!fs.existsSync(deploymentFile)) {
    console.error(`❌ Deployment file not found: ${deploymentFile}`);
    console.log("Please run deployment first: npx hardhat run scripts/deploy.ts --network <network>");
    process.exit(1);
  }
  
  const deploymentInfo: DeploymentInfo = JSON.parse(
    fs.readFileSync(deploymentFile, 'utf8')
  );
  console.log(`📋 Verifying contracts for network: ${networkName}`);
  
  // Contract addresses for Base Network
  const BASE_ADDRESSES: BaseNetworkAddresses = {
    base: {
      WETH: "0x4200000000000000000000000000000000000006",
      UNISWAP_V3_ROUTER: "0x2626664c2603336E57B271c5C0b26F421741e481",
      UNISWAP_V3_QUOTER: "0x3e6c707d0125226ff60f291b6bd1404634f00aba",
    },
    baseSepolia: {
      WETH: "0x4200000000000000000000000000000000000006",
      UNISWAP_V3_ROUTER: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
      UNISWAP_V3_QUOTER: "0x3e6c707d0125226ff60f291b6bd1404634f00aba",
    }
  };
  
  const networkAddresses: BaseAddresses = BASE_ADDRESSES[networkName as keyof typeof BASE_ADDRESSES] || BASE_ADDRESSES.baseSepolia;
  
  // Verify CompensationPool
  const compensationPoolAddress = deploymentInfo.contracts.CompensationPool.address;
  const compensationPoolArgs = [networkAddresses.WETH];
  
  await verifyContract(
    compensationPoolAddress,
    compensationPoolArgs,
    "CompensationPool"
  );
  
  // Verify PredictionRegistry
  const predictionRegistryAddress = deploymentInfo.contracts.PredictionRegistry.address;
  const predictionRegistryArgs = [compensationPoolAddress, networkAddresses.WETH];
  
  await verifyContract(
    predictionRegistryAddress,
    predictionRegistryArgs,
    "PredictionRegistry"
  );
  
  console.log("\n🎉 Verification process completed!");
  console.log("\n📋 Contract Addresses:");
  console.log("CompensationPool:", compensationPoolAddress);
  console.log("PredictionRegistry:", predictionRegistryAddress);
  
  // Generate verification URLs
  const baseExplorer = networkName === 'base' ? 'https://basescan.org' : 'https://sepolia.basescan.org';
  console.log("\n🔗 Verification URLs:");
  console.log(`CompensationPool: ${baseExplorer}/address/${compensationPoolAddress}#code`);
  console.log(`PredictionRegistry: ${baseExplorer}/address/${predictionRegistryAddress}#code`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Verification failed:", error);
    process.exit(1);
  });
