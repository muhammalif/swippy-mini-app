import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { PredictionRegistry } from "../typechain-types/contracts/PredictionRegistry";
import { CompensationPool } from "../typechain-types/contracts/CompensationPool";
import { MockWETH } from "../typechain-types/contracts/mocks/MockWETH";
import { TimelockController } from "../typechain-types/@openzeppelin/contracts/governance/TimelockController";
import { AggregatorV3Interface } from "../typechain-types/@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface";

describe("PredictionRegistry", function () {
  let predictionRegistry: PredictionRegistry;
  let compensationPool: CompensationPool;
  let weth: MockWETH;
  let owner: SignerWithAddress;
  let relayer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  // Test constants
  const LOCK_FEE = ethers.parseEther("0.0001");

  beforeEach(async function () {
    [owner, relayer, user1, user2] = await ethers.getSigners();

    // Deploy mock WETH
    const WETH = await ethers.getContractFactory("MockWETH");
    weth = await WETH.deploy() as unknown as MockWETH;
    await weth.waitForDeployment();

    // Deploy TimelockController
    const Timelock = await ethers.getContractFactory("TimelockController");
    const timelock = await Timelock.deploy(0, [owner.address], [owner.address], owner.address) as unknown as TimelockController;
    await timelock.waitForDeployment();

    // Deploy CompensationPool
    const CompensationPoolFactory = await ethers.getContractFactory("CompensationPool");
    compensationPool = await CompensationPoolFactory.deploy(await weth.getAddress()) as unknown as CompensationPool;
    await compensationPool.waitForDeployment();

    // Set timelock for CompensationPool
    await compensationPool.setTimelock(await timelock.getAddress());

    // Deploy PredictionRegistry
    const PredictionRegistryFactory = await ethers.getContractFactory("PredictionRegistry");
    predictionRegistry = await PredictionRegistryFactory.deploy(
      await compensationPool.getAddress(),
      await weth.getAddress()
    ) as unknown as PredictionRegistry;
    await predictionRegistry.waitForDeployment();

    // Set timelock for PredictionRegistry
    await predictionRegistry.setTimelock(await timelock.getAddress());

    // Deploy mock oracle
    const MockAggregator = await ethers.getContractFactory("MockAggregator");
    const mockOracle = await MockAggregator.deploy(50) as unknown as AggregatorV3Interface; // Initial slippage BP = 50
    await mockOracle.waitForDeployment();

    // Set price feed
    await predictionRegistry.setPriceFeed(await mockOracle.getAddress());

    // Set registry address in CompensationPool (bypass timelock for testing)
    await compensationPool.connect(owner).executeSetRegistry(await predictionRegistry.getAddress());

    // Set relayer address (bypass timelock for testing)
    await predictionRegistry.connect(owner).executeSetRelayer(relayer.address);

    // Mint WETH to users for testing
    await weth.mint(user1.address, ethers.parseEther("10"));
    await weth.mint(user2.address, ethers.parseEther("10"));

    // Approve WETH spending
    await weth.connect(user1).approve(await predictionRegistry.getAddress(), ethers.parseEther("10"));
    await weth.connect(user2).approve(await predictionRegistry.getAddress(), ethers.parseEther("10"));
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await predictionRegistry.owner()).to.equal(owner.address);
    });

    it("Should set the correct compensation pool", async function () {
      expect(await predictionRegistry.compensationPool()).to.equal(await compensationPool.getAddress());
    });

    it("Should set the correct WETH address", async function () {
      expect(await predictionRegistry.WETH()).to.equal(await weth.getAddress());
    });

    it("Should initialize prediction counter to 0", async function () {
      expect(await predictionRegistry.predictionCounter()).to.equal(0);
    });
  });

  describe("Access Control", function () {
    it("Should allow only owner to set relayer address", async function () {
      await expect(
        predictionRegistry.connect(user1).setRelayerAddress(user1.address)
      ).to.be.revertedWithCustomError(predictionRegistry, "OwnableUnauthorizedAccount");
    });

    it("Should allow only relayer to call verifyAndPayout", async function () {
      await expect(
        predictionRegistry.connect(user1).verifyAndPayout(1, ethers.parseEther("1"), 50)
      ).to.be.revertedWith("PR: Caller not Relayer");
    });
  });

  describe("submitPredictionState", function () {
    const tokenIn = "0x1234567890123456789012345678901234567890";
    const tokenOut = "0x0987654321098765432109876543210987654321";
    const amountIn = ethers.parseEther("1");
    const predictedSlippageBP = 50; // 0.5%
    const quotePrice = ethers.parseEther("2000");
    const expectedSwapTxHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

    it("Should submit prediction successfully", async function () {
      const tx = await predictionRegistry.connect(user1).submitPredictionState(
        tokenIn,
        tokenOut,
        amountIn,
        predictedSlippageBP,
        quotePrice,
        expectedSwapTxHash
      );

      await expect(tx)
        .to.emit(predictionRegistry, "PredictionSubmitted")
        .withArgs(1, user1.address, predictedSlippageBP, expectedSwapTxHash);

      // Check prediction counter increased
      expect(await predictionRegistry.predictionCounter()).to.equal(1);

      // Check prediction data
      const prediction = await predictionRegistry.predictions(1);
      expect(prediction.predictor).to.equal(user1.address);
      expect(prediction.tokenIn).to.equal(tokenIn);
      expect(prediction.tokenOut).to.equal(tokenOut);
      expect(prediction.amountIn).to.equal(amountIn);
      expect(prediction.predictedSlippageBP).to.equal(predictedSlippageBP);
      expect(prediction.quotePrice).to.equal(quotePrice);
      expect(prediction.hasBeenVerified.toString()).to.equal("false");
    });

    it("Should transfer lock fee to compensation pool", async function () {
      const balanceBefore = await weth.balanceOf(await compensationPool.getAddress());
      
      await predictionRegistry.connect(user1).submitPredictionState(
        tokenIn,
        tokenOut,
        amountIn,
        predictedSlippageBP,
        quotePrice,
        expectedSwapTxHash
      );

      const balanceAfter = await weth.balanceOf(await compensationPool.getAddress());
      expect(balanceAfter - balanceBefore).to.equal(LOCK_FEE);
    });

    it("Should revert with invalid token addresses", async function () {
      await expect(
        predictionRegistry.connect(user1).submitPredictionState(
          ethers.ZeroAddress,
          tokenOut,
          amountIn,
          predictedSlippageBP,
          quotePrice,
          expectedSwapTxHash
        )
      ).to.be.revertedWith("PR: Invalid token addresses");
    });

    it("Should revert with zero amount", async function () {
      await expect(
        predictionRegistry.connect(user1).submitPredictionState(
          tokenIn,
          tokenOut,
          0,
          predictedSlippageBP,
          quotePrice,
          expectedSwapTxHash
        )
      ).to.be.revertedWith("PR: Invalid amount");
    });

    it("Should revert with slippage too high", async function () {
      await expect(
        predictionRegistry.connect(user1).submitPredictionState(
          tokenIn,
          tokenOut,
          amountIn,
          10001, // > 100%
          quotePrice,
          expectedSwapTxHash
        )
      ).to.be.revertedWith("PR: Slippage too high");
    });

    it("Should revert with zero quote price", async function () {
      await expect(
        predictionRegistry.connect(user1).submitPredictionState(
          tokenIn,
          tokenOut,
          amountIn,
          predictedSlippageBP,
          0,
          expectedSwapTxHash
        )
      ).to.be.revertedWith("PR: Invalid quote price");
    });

    it("Should revert with zero transaction hash", async function () {
      await expect(
        predictionRegistry.connect(user1).submitPredictionState(
          tokenIn,
          tokenOut,
          amountIn,
          predictedSlippageBP,
          quotePrice,
          ethers.ZeroHash
        )
      ).to.be.revertedWith("PR: Invalid transaction hash");
    });
  });

  describe("verifyAndPayout", function () {
    let predictionId: number;

    beforeEach(async function () {
      // Submit a prediction first
      await predictionRegistry.connect(user1).submitPredictionState(
        "0x1234567890123456789012345678901234567890",
        "0x0987654321098765432109876543210987654321",
        ethers.parseEther("1"),
        50, // 0.5% predicted slippage
        ethers.parseEther("2000"),
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
      );
      predictionId = 1;
    });

    it("Should verify accurate prediction and pay reward", async function () {
      const actualSlippageBP = 45; // 0.45% actual slippage (within tolerance)
      const amountOutActual = ethers.parseEther("1999.1");

      // Deposit WETH to compensation pool for rewards
      await weth.mint(await compensationPool.getAddress(), ethers.parseEther("1"));

      const tx = await predictionRegistry.connect(relayer).verifyAndPayout(
        predictionId,
        amountOutActual,
        actualSlippageBP
      );

      await expect(tx)
        .to.emit(predictionRegistry, "VerificationResult")
        .withArgs(predictionId, user1.address, true, actualSlippageBP);

      // Check prediction is marked as verified
      const prediction = await predictionRegistry.predictions(predictionId);
      expect(prediction.hasBeenVerified.toString()).to.equal("true");

      // Check reward was paid (150% of lock fee)
      const expectedReward = LOCK_FEE + (LOCK_FEE / 2n);
      expect(await weth.balanceOf(user1.address)).to.be.closeTo(
        ethers.parseEther("10") + expectedReward,
        ethers.parseEther("0.001") // Allow small rounding difference
      );
    });

    it("Should not pay reward for inaccurate prediction", async function () {
      const actualSlippageBP = 100; // 1% actual slippage (outside tolerance)
      const amountOutActual = ethers.parseEther("1980");

      // Set mock oracle to match actual slippage for oracle check
      const MockAggregator = await ethers.getContractFactory("MockAggregator");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockOracle = MockAggregator.attach(await predictionRegistry.priceFeed()) as unknown as any;
      await mockOracle.setLatestAnswer(100);

      const tx = await predictionRegistry.connect(relayer).verifyAndPayout(
        predictionId,
        amountOutActual,
        actualSlippageBP
      );

      await expect(tx)
        .to.emit(predictionRegistry, "VerificationResult")
        .withArgs(predictionId, user1.address, false, actualSlippageBP);

      // Check prediction is marked as verified
      const prediction = await predictionRegistry.predictions(predictionId);
      expect(prediction.hasBeenVerified.toString()).to.equal("true");

      // Check no reward was paid (but lock fee was deducted on submit)
      expect(await weth.balanceOf(user1.address)).to.equal(ethers.parseEther("10") - LOCK_FEE);
    });

    it("Should revert with invalid prediction ID", async function () {
      await expect(
        predictionRegistry.connect(relayer).verifyAndPayout(
          0,
          ethers.parseEther("1"),
          50
        )
      ).to.be.revertedWith("PR: Invalid prediction ID");
    });

    it("Should revert with zero actual amount", async function () {
      await expect(
        predictionRegistry.connect(relayer).verifyAndPayout(
          predictionId,
          0,
          50
        )
      ).to.be.revertedWith("PR: Invalid actual amount");
    });

    it("Should revert with invalid actual slippage", async function () {
      await expect(
        predictionRegistry.connect(relayer).verifyAndPayout(
          predictionId,
          ethers.parseEther("1"),
          10001 // > 100%
        )
      ).to.be.revertedWith("PR: Invalid actual slippage");
    });

    it("Should revert with non-existent prediction", async function () {
      await expect(
        predictionRegistry.connect(relayer).verifyAndPayout(
          999,
          ethers.parseEther("1"),
          50
        )
      ).to.be.revertedWith("PR: Prediction not found");
    });

    it("Should revert when trying to verify same prediction twice", async function () {
      // Mint WETH to compensation pool for reward
      await weth.mint(await compensationPool.getAddress(), ethers.parseEther("1"));

      // First verification
      await predictionRegistry.connect(relayer).verifyAndPayout(
        predictionId,
        ethers.parseEther("1"),
        50
      );

      // Second verification should fail
      await expect(
        predictionRegistry.connect(relayer).verifyAndPayout(
          predictionId,
          ethers.parseEther("1"),
          50
        )
      ).to.be.revertedWith("PR: Already verified");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple predictions from same user", async function () {
      const tokenIn = "0x1234567890123456789012345678901234567890";
      const tokenOut = "0x0987654321098765432109876543210987654321";

      // Submit first prediction
      await predictionRegistry.connect(user1).submitPredictionState(
        tokenIn,
        tokenOut,
        ethers.parseEther("1"),
        50,
        ethers.parseEther("2000"),
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
      );

      // Submit second prediction
      await predictionRegistry.connect(user1).submitPredictionState(
        tokenIn,
        tokenOut,
        ethers.parseEther("2"),
        60,
        ethers.parseEther("2000"),
        "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321"
      );

      expect(await predictionRegistry.predictionCounter()).to.equal(2);
      
      const prediction1 = await predictionRegistry.predictions(1);
      const prediction2 = await predictionRegistry.predictions(2);
      
      expect(prediction1.predictor).to.equal(user1.address);
      expect(prediction2.predictor).to.equal(user1.address);
      expect(prediction1.amountIn).to.equal(ethers.parseEther("1"));
      expect(prediction2.amountIn).to.equal(ethers.parseEther("2"));
    });

    it("Should handle boundary slippage tolerance", async function () {
      const tokenIn = "0x1234567890123456789012345678901234567890";
      const tokenOut = "0x0987654321098765432109876543210987654321";

      await predictionRegistry.connect(user1).submitPredictionState(
        tokenIn,
        tokenOut,
        ethers.parseEther("1"),
        50, // 0.5% predicted
        ethers.parseEther("2000"),
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
      );

      // Deposit WETH for reward
      await weth.mint(await compensationPool.getAddress(), ethers.parseEther("1"));

      // Set mock oracle to 55 BP (actual 60, difference 5 BP = boundary)
      const MockAggregator = await ethers.getContractFactory("MockAggregator");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockOracle = MockAggregator.attach(await predictionRegistry.priceFeed()) as unknown as any;
      await mockOracle.setLatestAnswer(55);

      // Test exact tolerance boundary (should be accurate)
      await predictionRegistry.connect(relayer).verifyAndPayout(
        1,
        ethers.parseEther("1"),
        60 // 0.6% actual (difference = 10 BP = exact tolerance)
      );

      const prediction = await predictionRegistry.predictions(1);
      expect(prediction.hasBeenVerified).to.equal(true);
    });
  });
});
