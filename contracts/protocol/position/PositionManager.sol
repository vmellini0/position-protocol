pragma solidity ^0.8.0;
import {BlockContext} from "../libraries/helpers/BlockContext.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../libraries/position/TickPosition.sol";
import "../libraries/position/LimitOrder.sol";
import "../libraries/position/TickStore.sol";
import "../libraries/position/LiquidityBitmap.sol";

import "hardhat/console.sol";

contract PositionManager {
    using TickPosition for TickPosition.Data;
    using TickStore for mapping(int128 => uint256);
    using LiquidityBitmap for mapping(int128 => uint256);
    uint256 public basisPoint = 10001; //1.0001
    uint256 public constant basisPointBase = 100;
    struct SingleSlot {
        // percentage in point
        int128 pip;
    }
    SingleSlot public singleSlot;
    mapping(int128 => TickPosition.Data) public tickPosition;
    mapping(int128 => uint256) public tickStore;
    // a packed array of boolean, where liquidity is filled or not
    mapping(int128 => uint256) public liquidityBitmap;
//    mapping(uint64 => LimitOrder.Data) orderQueue;

    modifier whenNotPause(){
        //TODO implement
        _;
    }

    modifier onlyCounterParty(){
        //TODO implement
        _;
    }

    function hasLiquidity(int128 pip) public view returns(bool) {
        return liquidityBitmap.hasLiquidity(pip);
    }

    function getPendingOrderDetail(int128 pip, uint64 orderId) public view returns(
        bool isBuy,
        uint256 size
    ){
        return tickPosition[pip].getQueueOrder(orderId);
    }

    function currentPositionData(address _trader) external view returns (
        uint256 size,
        uint256 margin,
        uint256 openNotional
    ){
//        return;
    }

    function currentPositionPrice(address _trader) internal view returns(uint256) {
        //get overage of ticks
        return 0;
    }

    function openLimitPosition(int128 pip, uint128 size, bool isBuy) external whenNotPause onlyCounterParty {
        require(pip != singleSlot.pip, "!!"); //call market order instead
        if(isBuy && singleSlot.pip != 0){
            require(pip < singleSlot.pip, "!B");
        }else{
            require(pip > singleSlot.pip, "!S");
        }
        //TODO validate pip
        // convert tick to price
        // save at that pip has how many liquidity
        bool hasLiquidity = liquidityBitmap.hasLiquidity(pip);
        tickPosition[pip].insertLimitOrder(size, hasLiquidity, isBuy);
        if(!hasLiquidity){
            //set the bit to mark it has liquidity
            liquidityBitmap.toggleSingleBit(pip, true);
        }
        // TODO insert order to queue then return
    }

    struct SwapState {
        uint256 remainingSize;
        // the amount already swapped out/in of the output/input asset
        int256 amountCalculated;
        // the tick associated with the current price
        int128 pip;
    }

    struct StepComputations {
        // the price at the beginning of the step
        uint160 sqrtPriceStartX96;
        // the next tick to swap to from the current tick in the swap direction
        int24 tickNext;
        // whether tickNext is initialized or not
        bool initialized;
        uint64 nextLiquidity;
        // sqrt(price) for the next tick (1/0)
        uint160 sqrtPriceNextX96;
        // how much is being swapped in in this step
        uint256 amountIn;
        // how much is being swapped out
        uint256 amountOut;
        // how much fee is being paid in
        uint256 feeAmount;
    }


    function openMarketPosition(uint256 size, bool isLong) external whenNotPause onlyCounterParty returns (uint256 sizeOut) {
        require(size != 0, "!S");
        // TODO lock
        // get current tick liquidity
        TickPosition.Data storage tickData = tickPosition[singleSlot.pip];
        SwapState memory state = SwapState({
            remainingSize: size,
            amountCalculated: 0,
            pip: singleSlot.pip
        });
        while (state.remainingSize != 0){
            StepComputations memory step;
            // find the next tick has liquidity
            (state.pip) = liquidityBitmap.findNextInitializedLiquidity(
                state.pip,
                !isLong
            );
            // get liquidity at a tick index
            uint128 liquidity = tickPosition[state.pip].liquidity;
            if(liquidity > state.remainingSize){
                // pip position will partially filled and stop here
                tickPosition[state.pip].partiallyFill(state.remainingSize);
                state.remainingSize = 0;
            }else{
                // pip position will be fully filled
                state.remainingSize = state.remainingSize - liquidity;
            }
        }
        if(singleSlot.pip != state.pip){
            // all ticks in shifted range must be marked as filled
            liquidityBitmap.unsetBitsRange(singleSlot.pip, state.pip);
            singleSlot.pip = state.pip;
            // TODO write a checkpoint that we shift a range of ticks
        }
    }

}