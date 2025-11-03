import { ethers } from "hardhat";

export interface DeploymentAddresses {
  compensationPool: string;
  predictionRegistry: string;
  timelock: string;
  mockOracle: string;
}

/**
 * Setup timelock for contracts
 */
export async function setupTimelock(
  compensationPoolAddress: string,
  predictionRegistryAddress: string,
  timelockAddress: string
): Promise<void> {
  const compensationPool = await ethers.getContractAt("CompensationPool", compensationPoolAddress);
  const predictionRegistry = await ethers.getContractAt("PredictionRegistry", predictionRegistryAddress);

  await compensationPool.setTimelock(timelockAddress);
  await predictionRegistry.setTimelock(timelockAddress);

  console.log("✅ Timelock setup completed");
}

/**
 * Setup oracle for PredictionRegistry
 */
export async function setupOracle(
  predictionRegistryAddress: string,
  oracleAddress: string
): Promise<void> {
  const predictionRegistry = await ethers.getContractAt("PredictionRegistry", predictionRegistryAddress);
  await predictionRegistry.setPriceFeed(oracleAddress);
  console.log("✅ Oracle setup completed");
}

/**
 * Execute initial setup (registry and relayer addresses)
 */
export async function executeInitialSetup(
  compensationPoolAddress: string,
  predictionRegistryAddress: string,
  registryAddress: string,
  relayerAddress: string
): Promise<void> {
  const compensationPool = await ethers.getContractAt("CompensationPool", compensationPoolAddress);
  const predictionRegistry = await ethers.getContractAt("PredictionRegistry", predictionRegistryAddress);

  await compensationPool.executeSetRegistry(registryAddress);
  await predictionRegistry.executeSetRelayer(relayerAddress);

  console.log("✅ Initial setup executed");
}

/**
 * Deposit initial WETH to CompensationPool
 */
export async function depositInitialWETH(
  compensationPoolAddress: string,
  wethAddress: string,
  amount: string
): Promise<void> {
  const compensationPool = await ethers.getContractAt("CompensationPool", compensationPoolAddress);
  const weth = await ethers.getContractAt("IWETH", wethAddress);

  // Assume deployer has WETH or mint if mock
  const amountWei = ethers.parseEther(amount);
  await weth.approve(compensationPoolAddress, amountWei);
  await compensationPool.depositWETH(amountWei);

  console.log(`✅ Deposited ${amount} WETH to CompensationPool`);
}

/**
 * Get current pool balance
 */
export async function getPoolBalance(compensationPoolAddress: string): Promise<string> {
  const compensationPool = await ethers.getContractAt("CompensationPool", compensationPoolAddress);
  const balance = await compensationPool.getPoolBalance();
  return ethers.formatEther(balance);
}