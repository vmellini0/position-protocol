// SPDX-License-Identifier: agpl-3.0
pragma solidity =0.8.0;

//import {Amm} from "./Amm.sol";
import {IAmm} from "../../interfaces/a.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {Calc} from "../libraries/math/Calc.sol";
import {BlockContext} from "../libraries/helpers/BlockContext.sol";
import {IPositionHouse} from "../../interfaces/IPositionHouse.sol";
import {IInsuranceFund} from  "../../interfaces/IInsuranceFund.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "hardhat/console.sol";
//import "../../interfaces/a.sol";

/**
* @notice This contract is main of Position
* Manage positions with action like: openPostion, closePosition,...
*/

contract PositionHouse is IPositionHouse, BlockContext {
    using SafeMath for uint256;
    using Calc for uint256;


    // contract dependencies
    IInsuranceFund public insuranceFund;
    mapping(address => bool) whitelist;
    mapping(address => bool) blacklist;
    //    address[] whitelist;

    // event position house
    event MarginChanged(address indexed sender, address indexed amm, uint256 amount, int256 fundingPayment);


    function queryOrder(IAmm amm) public view returns (IAmm.Position[] memory positions){
        address trader = msg.sender;
        positions = amm.queryPositions(trader);
    }

    function getOrder(IAmm amm, int256 tick, uint256 index) public view returns (IAmm.Order memory order){

        order = amm.getOrder(msg.sender, tick, index);
    }

    function openPosition(
        IAmm _amm,
        IAmm.Side _side,
        uint256 _amountAssetQuote,
        uint256 _amountAssetBase,
        uint256 _leverage
    ) public {

        // TODO require something here
        require(
            _amountAssetBase != 0 &&
            _amountAssetQuote != 0,
            Errors.VL_INVALID_AMOUNT
        );
        address trader = msg.sender;

        uint256 _margin = _amountAssetQuote.div(_leverage);


        // TODO open market: calc liquidity filled.
        // if can cross tick => filled order next tick. Update filled liquidity, filled index

        //
        //        Side side,
        //        uint256 quoteAmount,
        //        uint256 leverage,
        //        uint256 margin,
        //        address _trader
        _amm.openMarket(IAmm.ParamsOpenMarket(
                _side,
                _amountAssetQuote,
                _amountAssetBase,
                _leverage,
                _margin,
                msg.sender));
        console.log("finish open market order");
    }

    function openLimitOrder(
        IAmm _amm,
        uint256 _amountAssetBase,
        uint256 _amountAssetQuote,
        uint256 _limitPrice,
        IAmm.Side _side,
        int256 _tick,
        uint256 _leverage) public {


        // TODO require for openLimitOrder
        int256 _currentTick = _amm.getCurrentTick();
        if (_side == IAmm.Side.BUY) {
            require(_tick < _currentTick, "Your ordered price is higher than current price");
        } else {
            require(_tick > _currentTick, "Your ordered price is lower than current price");
        }

        address _trader = msg.sender;

        uint256 _margin = _amountAssetQuote.div(_leverage);

        uint256 nextIndex = _amm.openLimit(
            _amountAssetBase,
            _amountAssetQuote,
            _limitPrice,
            _margin,
            _side,
            _tick,
            _leverage
        );

        _amm.addPositionMap(_trader, _tick, nextIndex);
        // TODO Save position

        // TODO emit event
        emit OpenLimitOrder(address(_amm), _trader, _tick, nextIndex);

    }


    function openStopLimit(IAmm.Side _side, uint256 _orderPrice, uint256 _limitPrice, uint256 _stopPrice, uint256 _amountAssetQuote) public {

    }


    function clearPosition() public {


    }


    function addMargin(IAmm _amm, uint256 index, int256 tick, uint256 _addedMargin) public {
        // check condition
        requireAmm(_amm, true);
        requireNonZeroInput(_addedMargin);
        // update margin part in personal position
        address trader = msg.sender;

        //        _amm.addMargin(index, tick, _addedMargin);
        emit MarginChanged(trader, address(_amm), _addedMargin, 0);
    }

    // TODO modify function
    function removeMargin(IAmm _amm, uint256 index, int256 tick, uint256 _amountRemoved) public {
        // check condition
        requireAmm(_amm, true);
        requireNonZeroInput(_amountRemoved);

        address _trader = msg.sender;

        _amm.removeMargin(_trader, _amountRemoved);
        //        emit MarginChanged(trader, address(_amm), int256(_amountRemoved.toUint()), 0);
    }

    // TODO modify function
    function withdraw(
        IERC20 _token,
        address _receiver,
        uint256 _amount
    ) internal {
        // if withdraw amount is larger than entire balance of vault
        // means this trader's profit comes from other under collateral position's future loss
        // and the balance of entire vault is not enough
        // need money from IInsuranceFund to pay first, and record this prepaidBadDebt
        // in this case, insurance fund loss must be zero
        //        uint256 memory totalTokenBalance = _balanceOf(_token, address(this));
        //        if (totalTokenBalance.toUint() < _amount.toUint()) {
        //            uint256 memory balanceShortage = _amount.subD(totalTokenBalance);
        //            prepaidBadDebt[address(_token)] = prepaidBadDebt[address(_token)].addD(balanceShortage);
        //            insuranceFund.withdraw(_token, balanceShortage);
        //        }
        //
        //        _transfer(_token, _receiver, _amount);
    }


    // TODO modify function
    function payFunding(IAmm _amm) public {
        requireAmm(_amm, true);
        uint256 premiumFraction = _amm.settleFunding();
        //        address(_amm).cumulativePremiumFractions.push(
        //            premiumFraction.add(getLatestCumulativePremiumFraction(_amm))
        //        );


        // funding payment = premium fraction * position
        // eg. if alice takes 10 long position, totalPositionSize = 10
        // if premiumFraction is positive: long pay short, amm get positive funding payment
        // if premiumFraction is negative: short pay long, amm get negative funding payment
        // if totalPositionSize.side * premiumFraction > 0, funding payment is positive which means profit
        uint256 totalTraderPositionSize = _amm.getTotalPositionSize();
        uint256 ammFundingPaymentProfit = premiumFraction.mul(totalTraderPositionSize);

        IERC20 quoteAsset = _amm.quoteAsset();
        //        if (ammFundingPaymentProfit.toInt() < 0) {
        //            insuranceFund.withdraw(quoteAsset, ammFundingPaymentProfit.abs());
        //        } else {
        //            transferToInsuranceFund(quoteAsset, ammFundingPaymentProfit.abs());
        //        }

    }


    // TODO modify function
    function realizeBadDebt(IERC20 _token, uint256 _badDebt) internal {
        //        uint256 memory badDebtBalance = prepaidBadDebt[address(_token)];
        //        if (badDebtBalance.toUint() > _badDebt.toUint()) {
        //            // no need to move extra tokens because vault already prepay bad debt, only need to update the numbers
        //            prepaidBadDebt[address(_token)] = badDebtBalance.subD(_badDebt);
        //        } else {
        //            // in order to realize all the bad debt vault need extra tokens from insuranceFund
        //            insuranceFund.withdraw(_token, _badDebt.sub(badDebtBalance));
        //            prepaidBadDebt[address(_token)] = Decimal.zero();
        //        }
    }


    // TODO modify function
    function transferToInsuranceFund(IERC20 _token, uint256 _amount) internal {
        //        uint256 memory totalTokenBalance = _balanceOf(_token, address(this));
        //        _transfer(
        //            _token,
        //            address(insuranceFund),
        //            totalTokenBalance.toUint() < _amount.toUint() ? totalTokenBalance : _amount
        //        );
    }


    function closePosition(IAmm _amm, uint256 index, uint256 tick) public {

        // TODO require close position

        address _trader = msg.sender;

        // TODO close position
        // calc PnL, transfer money
        //



        _amm.closePosition(_trader);
        //        ammMap[_amm].positionMap[_trader]
        //
        //        Position[] memory templePosition;
        //
        //        for (uint256 i = 0; i < address(_amm).positionMap[_trader].length; i++) {
        //            int256 tickOrder = address(_amm).positionMap[_trader][i].tick;
        //            uint256 indexOrder = address(_amm).positionMap[_trader][i].index;
        //
        //            if (_amm.getIsWaitingOrder(tickOrder, indexOrder) == true) {
        //                //                templePosition.push(Position(indexOrder, tickOrder));
        //
        //            }
        //
        //        }
        //
        //
        //        address(_amm).positionMap[_trader] = templePosition;


        // TODO emit event


    }


    /*
    cancel one limit order in waiting filled
    **/
    function cancelOrder(IAmm _amm, uint256 index, int256 tick) public {

        // TODO require close order AMM
        require(_amm.getIsOrderExecuted(tick, index) != true, "Your order has executed");
        //        bool flag = true;

        address _trader = msg.sender;

        _amm.cancelOrder(_trader, index, tick);


        emit CancelOrder(address(_amm), index, tick);
    }


    /*
    cancel all limit order in waiting filled
    **/
    function cancelAllOrder(IAmm _amm) public {

        address _trader = msg.sender;

        _amm.cancelAllOrder(_trader);


    }

    function getPrice(IAmm _amm) public view returns (uint256){
        return _amm.getPrice();
    }


    function getPosition(IAmm _amm, address _trader) public view returns (IAmm.Position memory positionsOpened, IAmm.Position memory positionOrder)  {

        // TODO require getPosition


        //        Position[] memory positions = address(_amm).positionMap[_trader];
        //
        //        for (uint256 i = 0; i < positions.length; i.add(1)) {
        //            int256 tick = positions[i].tick;
        //            uint256 index = positions[i].index;
        //
        //        }

    }





    // TODO modify function
    function getUnadjustedPosition(IAmm _amm, address _trader) public view returns (IAmm.Position memory position) {
        //        position = address(_amm).positionMap[_trader][0];
    }


    // TODO modify function
    function setWhitelist(address _address, bool isWhitelist) public {
        whitelist[_address] = isWhitelist;
    }


    // TODO modify function
    function setBlacklist(address _address, bool isBlacklist) public {

        blacklist[_address] = isBlacklist;

    }

    function getWhitelist(address _address) public returns (bool) {

        return whitelist[_address];
        //        tickOrder[tick].order[index].margin.add(amountAdded);
    }

    function getBlacklist(address _address) public returns (bool) {
        return blacklist[_address];
    }

    function requireNonZeroInput(uint256 _decimal) private pure {
        //!0: input is 0
        require(_decimal != 0, Errors.VL_INVALID_AMOUNT);
    }





    /**
    * @notice get latest cumulative premium fraction.
    * @param _amm IAmm address
    * @return latest cumulative premium fraction in 18 digits
    */
    function getLatestCumulativePremiumFraction(IAmm _amm) public view returns (uint256) {
        //        uint256 len = address(_amm).cumulativePremiumFractions.length;
        //        if (len > 0) {
        //            return address(_amm).cumulativePremiumFractions[len - 1];
        //        }
        return 0;
    }


    // require function
    function requireAmm(IAmm _amm, bool _open) private view {

        //405: amm not found
        //505: amm was closed
        //506: amm is open
        //        require(insuranceFund.isExistedAmm(_amm), "405");
        //        require(_open == _amm.open(), _open ? "505" : "506");
    }


}