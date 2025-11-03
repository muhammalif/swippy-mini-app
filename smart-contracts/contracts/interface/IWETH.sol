// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IWETH
 * @dev Interface untuk WETH di Base Network. Mewarisi IERC20.
 * Ini memastikan semua fungsi transfer WETH aman dan sesuai standar.
 */
interface IWETH is IERC20 {
    
}