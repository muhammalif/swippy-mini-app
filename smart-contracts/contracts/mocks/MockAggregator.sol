// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract MockAggregator is AggregatorV3Interface {
    int256 private latestAnswer;
    uint256 private latestTimestamp;

    constructor(int256 _initialAnswer) {
        latestAnswer = _initialAnswer;
        latestTimestamp = block.timestamp;
    }

    function setLatestAnswer(int256 _answer) external {
        latestAnswer = _answer;
        latestTimestamp = block.timestamp;
    }

    function decimals() external pure override returns (uint8) {
        return 0; // For BP, no decimals
    }

    function description() external pure override returns (string memory) {
        return "Mock Slippage Aggregator";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 _roundId) external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_roundId, latestAnswer, latestTimestamp, latestTimestamp, _roundId);
    }

    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (1, latestAnswer, latestTimestamp, latestTimestamp, 1);
    }
}