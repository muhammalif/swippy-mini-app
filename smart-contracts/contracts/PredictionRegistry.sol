// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "./CompensationPool.sol";
import "./interface/IWETH.sol";

contract PredictionRegistry is Ownable, ReentrancyGuard {

    // --- State & Constant ---

    CompensationPool public immutable compensationPool;
    IWETH public immutable WETH;

    // Allowed Relayer Addresses trigger verification
    address public relayerAddress;

    // Counter for prediction ID
    uint256 public predictionCounter;
    
    TimelockController public timelock;
    AggregatorV3Interface public priceFeed;

    // Mapping to save predictions
    mapping(uint256 => Prediction) public predictions;

    // Game Parameter
    uint256 public constant SLIPPAGE_TOLERANCE_BP = 10;
    uint256 public constant LOCK_FEE = 0.0001 ether;

    // Structure for storing prediction states
    struct Prediction {
        address predictor;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 predictedSlippageBP;
        uint256 quotePrice;
        bool hasBeenVerified;
    }

    // --- Events ---
    event PredictionSubmitted(uint256 indexed id, address indexed user, uint256 predictedBP, bytes32 indexed txSwapHash);
    event VerificationResult(uint256 indexed id, address indexed user, bool isAccurate, uint256 actualSlippageBP);
    event VerificationFailed(uint256 indexed predictionId, address indexed predictor, string reason);

    // --- Modifiers ---
    modifier onlyRelayer() {
        require(msg.sender == relayerAddress, "PR: Caller not Relayer");
        _;
    }

    // --- Constructor & Admin ---
    constructor(address payable _compensationPool, address _weth) Ownable(msg.sender) {
        require(_weth != address(0), "PR: Invalid WETH address");
        compensationPool = CompensationPool(_compensationPool);
        WETH = IWETH(_weth);
    }

    function setRelayerAddress(address _relayer) external onlyOwner {
        require(_relayer != address(0), "PR: Invalid address");
        // Schedule execution with 3 days delay
        timelock.schedule(
            address(this),
            0,
            abi.encodeWithSignature("executeSetRelayer(address)", _relayer),
            bytes32(0),
            bytes32(0),
            3 days
        );
    }

    // Set timelock address
    function setTimelock(address _timelock) external onlyOwner {
        timelock = TimelockController(payable(_timelock));
    }

    // Set oracle address
    function setPriceFeed(address _priceFeed) external onlyOwner {
        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    // Internal function to execute after timelock
    function executeSetRelayer(address _relayer) external {
        require(msg.sender == address(timelock) || msg.sender == owner(), "PR: Only timelock or owner");
        relayerAddress = _relayer;
    }



    // --- Main Function ---
    // This function is called by the Mini App. The user must have approved WETH for the Registry Contract.
    function submitPredictionState(
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn,
        uint256 _predictedSlippageBP,
        uint256 _quotePrice,
        bytes32 _expectedSwapTxHash
    ) external nonReentrant {
        // Input validation
        require(_tokenIn != address(0) && _tokenOut != address(0), "PR: Invalid token addresses");
        require(_amountIn > 0 && _amountIn <= 1e30, "PR: Invalid amount");
        require(_predictedSlippageBP <= 10000, "PR: Slippage too high"); // Max 100%
        require(_quotePrice > 0, "PR: Invalid quote price");
        require(_expectedSwapTxHash != bytes32(0), "PR: Invalid transaction hash");
        
        // Validate fee transfer
        require(WETH.transferFrom(msg.sender, address(compensationPool), LOCK_FEE), "PR: WETH transfer failed (Lock Fee)");

        // Recording the predicted State
        predictionCounter++;
        uint256 id = predictionCounter;

        predictions[id] = Prediction({
            predictor: msg.sender,
            tokenIn: _tokenIn,
            tokenOut: _tokenOut,
            amountIn: _amountIn,
            predictedSlippageBP: _predictedSlippageBP,
            quotePrice: _quotePrice,
            hasBeenVerified: false
        });

        emit PredictionSubmitted(id, msg.sender, _predictedSlippageBP, _expectedSwapTxHash);
    }

    // --- Verification Function ---
    // Function is called by the Relayer after a successful Swap.
    function verifyAndPayout(
        uint256 _predictionId,
        uint256 _amountOutActual,
        uint256 _actualSlippageBP
    ) external onlyRelayer nonReentrant {
        // Input validation
        require(_predictionId > 0, "PR: Invalid prediction ID");
        require(_amountOutActual > 0, "PR: Invalid actual amount");
        require(_actualSlippageBP <= 10000, "PR: Invalid actual slippage"); // Max 100%

        // Fetch oracle data for verification
        (, int256 oracleSlippage,,,) = priceFeed.latestRoundData();
        uint256 oracleSlippageBP = uint256(oracleSlippage);
        uint256 oracleDifference = oracleSlippageBP > _actualSlippageBP ? oracleSlippageBP - _actualSlippageBP : _actualSlippageBP - oracleSlippageBP;
        require(oracleDifference <= 5, "PR: Slippage mismatch with oracle");
        
        Prediction storage p = predictions[_predictionId];
        require(p.predictor != address(0), "PR: Prediction not found");
        require(!p.hasBeenVerified, "PR: Already verified");

        // Check the accuracy of the prediction
        uint256 predictedBP = p.predictedSlippageBP;
        uint256 actualBP = _actualSlippageBP;

        // Calculate the absolute difference between the predicted and actual results.
        uint256 difference;
        if (actualBP > predictedBP) {
            difference = actualBP - predictedBP;
        } else {
            difference = predictedBP - actualBP;
        }

        bool isAccurate = difference <= SLIPPAGE_TOLERANCE_BP;

        // Determining Rewards
        if (isAccurate) {
            // Reward
            uint256 compensationAmount = LOCK_FEE + (LOCK_FEE / 2);

            // Call Pool for Payout (gas sponsored by Paymaster)
            compensationPool.payCompensation(payable(p.predictor), compensationAmount, _predictionId);
        } else {
            // Emit failure reason for transparency
            string memory reason = string(abi.encodePacked("Slippage difference: ", Strings.toString(difference), " BP > ", Strings.toString(SLIPPAGE_TOLERANCE_BP), " BP"));
            emit VerificationFailed(_predictionId, p.predictor, reason);
        }

        p.hasBeenVerified = true;
        emit VerificationResult(_predictionId, p.predictor, isAccurate, actualBP);
    }

    // View function for frontend integration
    function getUserPredictions(address user) external view returns (uint256[] memory ids) {
        uint256 count = 0;
        for (uint256 i = 1; i <= predictionCounter; i++) {
            if (predictions[i].predictor == user) {
                count++;
            }
        }
        ids = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= predictionCounter; i++) {
            if (predictions[i].predictor == user) {
                ids[index] = i;
                index++;
            }
        }
    }
}