import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CompensationPool } from "../typechain-types/contracts/CompensationPool";
import { MockWETH } from "../typechain-types/contracts/mocks/MockWETH";
import { TimelockController } from "../typechain-types/@openzeppelin/contracts/governance/TimelockController";

describe("CompensationPool", function () {
  let compensationPool: CompensationPool;
  let weth: MockWETH;
  let owner: SignerWithAddress;
  let registry: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, registry, user1, user2] = await ethers.getSigners();

    // Deploy mock WETH
    const WETH = await ethers.getContractFactory("MockWETH");
    weth = await WETH.deploy() as unknown as MockWETH;
    await weth.waitForDeployment();

    // Deploy CompensationPool
    const CompensationPoolFactory = await ethers.getContractFactory("CompensationPool");
    compensationPool = await CompensationPoolFactory.deploy(await weth.getAddress()) as unknown as CompensationPool;
    await compensationPool.waitForDeployment();

    // Mint WETH to users for testing
    await weth.mint(user1.address, ethers.parseEther("10"));
    await weth.mint(user2.address, ethers.parseEther("10"));

    // Approve WETH spending
    await weth.connect(user1).approve(await compensationPool.getAddress(), ethers.parseEther("10"));
    await weth.connect(user2).approve(await compensationPool.getAddress(), ethers.parseEther("10"));
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await compensationPool.owner()).to.equal(owner.address);
    });

    it("Should set the correct WETH address", async function () {
      expect(await compensationPool.WETH()).to.equal(await weth.getAddress());
    });

    it("Should initialize registry address to zero", async function () {
      // Before setting registry address
      const newPool = await ethers.getContractFactory("CompensationPool");
      const newCompensationPool = await newPool.deploy(await weth.getAddress());
      await newCompensationPool.waitForDeployment();
      
      expect(await newCompensationPool.registryAddress()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Access Control", function () {
    it("Should allow only owner to set registry address", async function () {
      await expect(
        compensationPool.connect(user1).setRegistryAddress(user1.address)
      ).to.be.revertedWithCustomError(compensationPool, "OwnableUnauthorizedAccount");
    });

    it("Should allow only registry to call payCompensation", async function () {
      await expect(
        compensationPool.connect(user1).payCompensation(user1.address, ethers.parseEther("1"), 1)
      ).to.be.revertedWith("CP: Caller not Registry");
    });

    it("Should allow only owner to call emergencyWithdraw", async function () {
      await expect(
        compensationPool.connect(user1).emergencyWithdraw(await weth.getAddress(), ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(compensationPool, "OwnableUnauthorizedAccount");
    });
  });

  describe("setRegistryAddress", function () {
    beforeEach(async function () {
      // Deploy a new pool for these tests to ensure registry is not set
      const CompensationPoolFactory = await ethers.getContractFactory("CompensationPool");
      compensationPool = await CompensationPoolFactory.deploy(await weth.getAddress()) as unknown as CompensationPool;
      await compensationPool.waitForDeployment();

      // Deploy timelock for this test
      const Timelock = await ethers.getContractFactory("TimelockController");
      const timelock = await Timelock.deploy(0, [], [], owner.address) as unknown as TimelockController;
      await timelock.waitForDeployment();

      // Grant PROPOSER_ROLE and EXECUTOR_ROLE to owner
      const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
      const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
      await timelock.connect(owner).grantRole(PROPOSER_ROLE, owner.address);
      await timelock.connect(owner).grantRole(EXECUTOR_ROLE, owner.address);

      await compensationPool.setTimelock(await timelock.getAddress());
    });

    it("Should set registry address successfully", async function () {
      await compensationPool.connect(owner).executeSetRegistry(user1.address);
      expect(await compensationPool.registryAddress()).to.equal(user1.address);
    });

    it("Should revert with zero address", async function () {
      await expect(
        compensationPool.setRegistryAddress(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid address");
    });

    it("Should revert when trying to set registry address twice", async function () {
      await compensationPool.connect(owner).executeSetRegistry(user1.address);

      await expect(
        compensationPool.connect(owner).executeSetRegistry(user2.address)
      ).to.be.revertedWith("CP: Registry already set");
    });
  });

  describe("depositWETH", function () {
    it("Should deposit WETH successfully", async function () {
      const depositAmount = ethers.parseEther("1");
      
      const tx = await compensationPool.connect(user1).depositWETH(depositAmount);
      
      await expect(tx)
        .to.emit(compensationPool, "FundsDeposited")
        .withArgs(await weth.getAddress(), user1.address, depositAmount);

      expect(await weth.balanceOf(await compensationPool.getAddress())).to.equal(depositAmount);
    });

    it("Should revert with zero amount", async function () {
      await expect(
        compensationPool.connect(user1).depositWETH(0)
      ).to.be.revertedWith("CP: Invalid amount");
    });

    it("Should revert with insufficient allowance", async function () {
      // Revoke allowance
      await weth.connect(user1).approve(await compensationPool.getAddress(), 0);

      await expect(
        compensationPool.connect(user1).depositWETH(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(weth, "ERC20InsufficientAllowance");
    });

    it("Should revert with insufficient balance", async function () {
      // Set allowance higher than balance
      await weth.connect(user1).approve(await compensationPool.getAddress(), ethers.parseEther("1000"));

      await expect(
        compensationPool.connect(user1).depositWETH(ethers.parseEther("100")) // More than user has
      ).to.be.revertedWithCustomError(weth, "ERC20InsufficientBalance");
    });
  });

  describe("payCompensation", function () {
    beforeEach(async function () {
      // Deposit WETH to pool
      await compensationPool.connect(user1).depositWETH(ethers.parseEther("5"));
    });

    it("Should pay compensation successfully", async function () {
      const compensationAmount = ethers.parseEther("1");
      const predictionId = 123;

      const tx = await compensationPool.connect(registry).payCompensation(
        user2.address,
        compensationAmount,
        predictionId
      );

      await expect(tx)
        .to.emit(compensationPool, "CompensationPaid")
        .withArgs(user2.address, compensationAmount, predictionId);

      expect(await weth.balanceOf(user2.address)).to.equal(
        ethers.parseEther("10") + compensationAmount
      );
    });

    it("Should revert with zero amount", async function () {
      await expect(
        compensationPool.connect(registry).payCompensation(user2.address, 0, 1)
      ).to.be.revertedWith("CP: Invalid amount");
    });

    it("Should revert with insufficient balance", async function () {
      await expect(
        compensationPool.connect(registry).payCompensation(
          user2.address,
          ethers.parseEther("100"), // More than pool has
          1
        )
      ).to.be.revertedWithCustomError(weth, "ERC20InsufficientBalance");
    });

    it("Should revert when called by non-registry", async function () {
      await expect(
        compensationPool.connect(user1).payCompensation(user2.address, ethers.parseEther("1"), 1)
      ).to.be.revertedWith("CP: Caller not Registry");
    });
  });

  describe("emergencyWithdraw", function () {
    beforeEach(async function () {
      // Deposit WETH to pool
      await compensationPool.connect(user1).depositWETH(ethers.parseEther("5"));
      
      // Send native ETH to contract
      await owner.sendTransaction({
        to: await compensationPool.getAddress(),
        value: ethers.parseEther("2")
      });
    });

    it("Should withdraw WETH successfully", async function () {
      const withdrawAmount = ethers.parseEther("1");
      const ownerBalanceBefore = await weth.balanceOf(owner.address);

      await compensationPool.emergencyWithdraw(await weth.getAddress(), withdrawAmount);

      expect(await weth.balanceOf(owner.address)).to.equal(
        ownerBalanceBefore + (withdrawAmount as bigint)
      );
      expect(await weth.balanceOf(await compensationPool.getAddress())).to.equal(
        ethers.parseEther("4") // 5 - 1
      );
    });

    it("Should withdraw native ETH successfully", async function () {
      const withdrawAmount = ethers.parseEther("1");
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await compensationPool.emergencyWithdraw(ethers.ZeroAddress, withdrawAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      expect(await ethers.provider.getBalance(owner.address)).to.equal(
        ownerBalanceBefore + withdrawAmount - gasUsed
      );
    });

    it("Should revert with zero amount", async function () {
      await expect(
        compensationPool.emergencyWithdraw(await weth.getAddress(), 0)
      ).to.be.revertedWith("CP: Zero amount");
    });

    it("Should revert with insufficient WETH balance", async function () {
      await expect(
        compensationPool.emergencyWithdraw(await weth.getAddress(), ethers.parseEther("100"))
      ).to.be.revertedWith("CP: Insufficient token balance");
    });

    it("Should revert with insufficient ETH balance", async function () {
      await expect(
        compensationPool.emergencyWithdraw(ethers.ZeroAddress, ethers.parseEther("100"))
      ).to.be.revertedWith("CP: Insufficient ETH balance");
    });

    it("Should revert when called by non-owner", async function () {
      await expect(
        compensationPool.connect(user1).emergencyWithdraw(await weth.getAddress(), ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(compensationPool, "OwnableUnauthorizedAccount");
    });
  });

  describe("Integration Tests", function () {
    it("Should handle multiple deposits and payouts", async function () {
      // Multiple deposits
      await compensationPool.connect(user1).depositWETH(ethers.parseEther("2"));
      await compensationPool.connect(user2).depositWETH(ethers.parseEther("3"));

      expect(await weth.balanceOf(await compensationPool.getAddress())).to.equal(
        ethers.parseEther("5")
      );

      // Multiple payouts
      await compensationPool.connect(registry).payCompensation(
        user1.address,
        ethers.parseEther("1"),
        1
      );
      await compensationPool.connect(registry).payCompensation(
        user2.address,
        ethers.parseEther("2"),
        2
      );

      expect(await weth.balanceOf(await compensationPool.getAddress())).to.equal(
        ethers.parseEther("2") // 5 - 1 - 2
      );
    });

    it("Should handle edge case with exact balance withdrawal", async function () {
      // Deposit some WETH first
      await compensationPool.connect(user1).depositWETH(ethers.parseEther("1"));

      const poolBalance = await weth.balanceOf(await compensationPool.getAddress());

      await compensationPool.emergencyWithdraw(await weth.getAddress(), poolBalance);

      expect(await weth.balanceOf(await compensationPool.getAddress())).to.equal(0);
    });
  });
});
