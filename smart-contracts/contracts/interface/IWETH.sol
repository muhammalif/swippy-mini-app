// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IWETH
 * @dev Interface for WETH on Base Network. Inheriting IERC20.
 * This ensures all WETH transfer functions are secure and up to standards.
 */
interface IWETH is IERC20 {
    
}