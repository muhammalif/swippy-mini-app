// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "./interface/IWETH.sol";

contract CompensationPool is Ownable, ReentrancyGuard {
    // --- STATE & EVENTS

    // Only WETH to using for payout
    address public immutable WETH;
    address public registryAddress;
    TimelockController public timelock;

    // Events for transparency and monitoring by Relayer/Indexer
    event FundsDeposited(address indexed token, address indexed user, uint256 amount);
    event CompensationPaid(address indexed recipient, uint256 amount, uint256 predictionId);

    // --- Modifiers ---
    modifier onlyRegistry() {
        require(msg.sender == registryAddress, "CP: Caller not Registry");
        _;
    }

    // --- CONSTRUCTOR & ADMIN
    constructor(address _weth) Ownable(msg.sender) {
        require(_weth != address(0), "CP: Invalid WETH address");
        WETH = _weth;
    }

    // Function for setting the registry address with timelock
    function setRegistryAddress(address _registry) external onlyOwner {
        require(registryAddress == address(0), "CP: Registry already set");
        require(_registry != address(0), "Invalid address");
        // Schedule execution with 3 days delay
        timelock.schedule(
            address(this),
            0,
            abi.encodeWithSignature("executeSetRegistry(address)", _registry),
            bytes32(0),
            bytes32(0),
            3 days
        );
    }

    // Set timelock address
    function setTimelock(address _timelock) external onlyOwner {
        timelock = TimelockController(payable(_timelock));
    }

    // Internal function to execute after timelock
    function executeSetRegistry(address _registry) external {
        require(msg.sender == address(timelock) || msg.sender == owner(), "CP: Only timelock or owner");
        require(registryAddress == address(0), "CP: Registry already set");
        registryAddress = _registry;
    }

    // --- FUNCTIONS --- 
    // Deposit Function
    function depositWETH(uint256 amount) external {
        require(amount > 0 && amount <= 1e30, "CP: Invalid amount");
        require(IWETH(WETH).transferFrom(msg.sender, address(this), amount), "CP: WETH transfer failed");
        emit FundsDeposited(WETH, msg.sender, amount);
    }


    // Payout Function
    function payCompensation(address payable _recipient, uint256 _amount, uint256 _predictionId) external nonReentrant onlyRegistry {
        require(_amount > 0 && _amount <= 1e30, "CP: Invalid amount");

        require(IWETH(WETH).transfer(_recipient, _amount), "CP: WETH transfer failed");

        emit CompensationPaid(_recipient, _amount, _predictionId);
    }

    // Emergency Withdraw Function
    function emergencyWithdraw(address _token, uint256 _amount) external onlyOwner {
        require(_amount > 0, "CP: Zero amount");

        if (_token == address(0)) {
            // Withdraw native ETH
            require(address(this).balance >= _amount, "CP: Insufficient ETH balance");
            (bool success, ) = payable(owner()).call{value: _amount}("");
            require(success, "ETH withdraw failed");
        } else {
            // Withdraw ERC20 Token
            require(IWETH(_token).balanceOf(address(this)) >= _amount, "CP: Insufficient token balance");
            require(IWETH(_token).transfer(owner(), _amount), "Token withdraw failed");
        }
    }

    // View function for frontend integration
    function getPoolBalance() external view returns (uint256) {
        return IWETH(WETH).balanceOf(address(this));
    }

    // Allow contract to receive ETH
    receive() external payable {}
}