// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockWETH
 * @dev Mock WETH contract for testing purposes
 */
contract MockWETH is ERC20 {
    constructor() ERC20("Mock Wrapped Ether", "mWETH") {}

    /**
     * @dev Mint tokens to an address (for testing only)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @dev Burn tokens from an address (for testing only)
     */
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    /**
     * @dev Deposit ETH and mint WETH (simplified version)
     */
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    /**
     * @dev Withdraw WETH and get ETH back (simplified version)
     */
    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(amount);
    }

    /**
     * @dev Receive ETH
     */
    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}
