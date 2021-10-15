import {BigNumber, BigNumberish, ContractFactory, Signer, Wallet} from 'ethers'
import {ethers, waffle} from 'hardhat'
// import {PositionHouse} from "../../typeChain";
import {loadFixture} from "ethereum-waffle";
// import checkObservationEquals from "../../shared/checkObservationEquals";
// import snapshotGasCost from "../../shared/snapshotGasCost";
// import {expect} from "../../shared/expect";
// import {TEST_POOL_START_TIME} from "../../shared/fixtures";
import {describe} from "mocha";
import {expect} from 'chai'
import {PositionManager, PositionHouse} from "../../typeChain";
import {
    ClaimFund,
    LimitOrderReturns,
    PositionData,
    PositionLimitOrderID,
    priceToPip, SIDE,
    toWeiBN,
    toWeiWithString
} from "../shared/utilities";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

describe("PositionHouse_02", () => {
    let positionHouse: PositionHouse;
    let trader: any;
    let trader1: any;
    let trader2: any;
    let trader3: any;
    let trader4: any;
    let trader5: any;
    let tradercp: any;
    let positionManager: PositionManager;
    let positionManagerFactory: ContractFactory;

    beforeEach(async () => {
        [trader, trader1, trader2, trader3, trader4, trader5, tradercp] = await ethers.getSigners()
        positionManagerFactory = await ethers.getContractFactory("PositionManager")
        // BTC-USD Perpetual, initial price is 5000
        // each pip = 0.01
        // => initial pip = 500000
        //quoteAsset    BUSD_TestNet = 0x8301f2213c0eed49a7e28ae4c3e91722919b8b47
        positionManager = (await positionManagerFactory.deploy(500000, '0x8301f2213c0eed49a7e28ae4c3e91722919b8b47')) as unknown as PositionManager;
        const factory = await ethers.getContractFactory("PositionHouse")
        positionHouse = (await factory.deploy()) as unknown as PositionHouse;
    })

    const openMarketPosition = async ({
                                          quantity,
                                          leverage,
                                          side,
                                          trader,
                                          instanceTrader,
                                          expectedMargin,
                                          expectedNotional,
                                          expectedSize,
                                          price = 5000,
                                          _positionManager = positionManager
                                      }: {
        quantity: BigNumber,
        leverage: number,
        side: number,
        trader?: string,
        instanceTrader: any,
        expectedMargin?: BigNumber,
        expectedNotional?: BigNumber | string,
        expectedSize?: BigNumber,
        price?: number,
        _positionManager?: any
    }) => {
        trader = instanceTrader && instanceTrader.address || trader
        if (!trader) throw new Error("No trader")
        await positionHouse.connect(instanceTrader).openMarketPosition(
            _positionManager.address,
            side,
            quantity,
            leverage,
        )

        const positionInfo = await positionHouse.getPosition(_positionManager.address, trader) as unknown as PositionData;
        // console.log("positionInfo", positionInfo)
        const currentPrice = Number((await _positionManager.getPrice()).toString())
        const openNotional = positionInfo.openNotional.div('10000').toString()
        expectedNotional = expectedNotional && expectedNotional.toString() || quantity.mul(price).toString()
        // console.table([
        //     {
        //         openNotional: positionInfo.openNotional.toString(),
        //         openNotionalFormated: openNotional,
        //         currentPrice: currentPrice,
        //         quantity: positionInfo.quantity.toString()
        //     }
        // ])
        expect(positionInfo.quantity.toString()).eq(expectedSize || quantity.toString())
        // expect(openNotional).eq(expectedNotional)
        // expectedMargin && expect(positionInfo.margin.div('10000').toString()).eq(expectedMargin.toString())
    }

    interface OpenLimitPositionAndExpectParams {
        _trader?: SignerWithAddress
        limitPrice: number | string
        leverage: number,
        quantity: number
        side: number
        _positionManager?: PositionManager
    }


    async function debugPendingOrder(pip: any, orderId: any) {
        const res = await positionManager.getPendingOrderDetail(pip, orderId)
        console.table([
            {
                pip,
                orderId: orderId.toString(),
                isFilled: res.isFilled,
                isBuy: res.isBuy,
                size: res.size.toString(),
                partialFilled: res.partialFilled.toString(),
            }
        ])
    }

    async function getOrderIdByTx(tx: any) {
        const receipt = await tx.wait();
        const orderId = ((receipt?.events || [])[1]?.args || [])['orderId']
        const priceLimit = ((receipt?.events || [])[1]?.args || [])['priceLimit']
        return {
            orderId,
            priceLimit,
        }
    }

    async function openLimitPositionAndExpect({
                                                  _trader,
                                                  limitPrice,
                                                  leverage,
                                                  quantity,
                                                  side,
                                                  _positionManager
                                              }: OpenLimitPositionAndExpectParams): Promise<LimitOrderReturns> {
        _positionManager = _positionManager || positionManager
        _trader = _trader || trader
        if (!_positionManager) throw Error("No position manager")
        if (!_trader) throw Error("No trader")
        const tx = await positionHouse.connect(_trader).openLimitOrder(_positionManager.address, side, quantity, priceToPip(Number(limitPrice)), leverage, true)
        const {orderId, priceLimit} = await getOrderIdByTx(tx)
        console.log('orderId: ', orderId.toString())
        console.log('priceLimit: ', priceLimit.toString());
        // const positionLimitInOrder = (await positionHouse["getPendingOrder(address,bytes)"](_positionManager.address, orderId)) as unknown as PendingOrder;
        // expect(positionLimitInOrder.size.toNumber()).eq(quantity);

        return {
            orderId: orderId,
            pip: priceToPip(Number(limitPrice))
        } as LimitOrderReturns
        // expect(positionLimitInOrder..div(10000)).eq(limitPrice);
    }

    interface ChangePriceParams {
        limitPrice: number | string
        toHigherPrice: boolean
        _positionManager?: PositionManager
    }

    async function changePrice({
                                   limitPrice,
                                   toHigherPrice
                               }: ChangePriceParams) {
        if (toHigherPrice) {
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: limitPrice,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 3,
                _trader: tradercp,
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: tradercp.address,
                    instanceTrader: tradercp,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from(0)
                }
            );
        } else {
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: limitPrice,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 3,
                _trader: tradercp,
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: tradercp.address,
                    instanceTrader: tradercp,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from(0)
                }
            );
        }
    }

    const closePosition = async ({
                                     trader,
                                     instanceTrader,
                                     _positionManager = positionManager
                                 }: {
        trader: string,
        instanceTrader: any,
        _positionManager?: any
    }) => {
        const positionData1 = (await positionHouse.connect(instanceTrader).getPosition(_positionManager.address, trader)) as unknown as PositionData;
        // await positionHouse.connect(instanceTrader).closePosition(_positionManager.address, BigNumber.from(positionData1.quantity.toString()));
        await positionHouse.connect(instanceTrader).closePosition(_positionManager.address);
        const positionData = (await positionHouse.getPosition(_positionManager.address, trader)) as unknown as PositionData;
        expect(positionData.margin).eq(0);
        expect(positionData.quantity).eq(0);
    }

    describe('reduce size position', async function () {


        it('reduce size by reverse limit order', async function () {


        })


    })

    describe('Increase size in order', async () => {

        /**
         * Code: PS_FUTU_21
         - S1: Trade0 open Limit Long(4980,8)
         - S2: Trade1 open Market SHORT(8)
         - S3: Trade2 open Limit Long(4950,7)
         - S4: Trade1 open market SHORT(5)
         - S5: Trade0 open Limit Long(4900,6)
         - S6: Trade1 open Market SHORT(5)
         - S7: Trade3 open Market SHORT(1)
         - S8: Trade2 open Limit Long(4850,4)=>  2
         - S9: Trade3 open Market SHORT(4)

         - S10: Trade(cp1) open Limit short(5000,2)
         - S11: Trade(cp2) open Market long(2)
         */
        it('PS_FUTU_21 increase size by market order and limit order', async () => {
            console.log('****** Step 1 and Step 2')
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 8,
                _trader: trader
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('8'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-8')
                }
            );


            console.log('****** Step 3 and Step 4')

            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 4950,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 7,
                _trader: trader2
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-13'),
                }
            );


            console.log('****** Step 5 and Step 6')

            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 4900,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 6,
                _trader: trader
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-18'),
                }
            );


            console.log('****** Step 7 and Step 8')

            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-1')
                }
            );

            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 4850,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 4,
                _trader: trader2
            })) as unknown as PositionLimitOrderID


            console.log('****** Step 9')

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader3.address,
                    instanceTrader: trader3,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5'),
                    expectedNotional: BigNumber.from('24400')
                }
            );

            console.log('****** Step 10 and 11')

            await changePrice({
                limitPrice: 5000,
                toHigherPrice: true
            })

            const positionNotionalAndPnLTrader0 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader.address,
                1
            )
            const positionTrader0 = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData
            expect(positionTrader0.openNotional.div((10000))).eq(69240);
            expect(positionTrader0.margin.div((10000))).eq(6924);
            expect(positionNotionalAndPnLTrader0.unrealizedPnl.div(10000)).eq(760)


            const positionNotionalAndPnLTrader1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader1.address,
                1
            )
            const positionTrader1 = (await positionHouse.getPosition(positionManager.address, trader1.address)) as unknown as PositionData
            expect(positionTrader1.openNotional.div((10000))).eq(89190);
            expect(positionTrader1.margin.div((10000))).eq(8919);
            expect(positionNotionalAndPnLTrader1.unrealizedPnl.div(10000)).eq(-810)

            const positionNotionalAndPnLTrader2 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader2.address,
                1
            )
            const positionTrader2 = (await positionHouse.getPosition(positionManager.address, trader2.address)) as unknown as PositionData
            expect(positionTrader2.openNotional.div((10000))).eq(44350);
            expect(positionTrader2.margin.div((10000))).eq(4435);
            expect(positionNotionalAndPnLTrader2.unrealizedPnl.div(10000)).eq(650)

            const positionNotionalAndPnLTrader3 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader3.address,
                1
            )
            const positionTrader3 = (await positionHouse.getPosition(positionManager.address, trader3.address)) as unknown as PositionData
            expect(positionTrader3.openNotional.div((10000))).eq(24400);
            expect(positionTrader3.margin.div((10000))).eq(2440);
            expect(positionNotionalAndPnLTrader3.unrealizedPnl.div(10000)).eq(-600)

        })

    })

    describe('Market reverse Market; Limit reverse Limit', async () => {

        /**
         PS_FUTU_22
         -S1: Trade0 open Limit Long(4980,15)
         -S2: Trade1 open Market SHORT(11)
         -S3: Trade0 open Limit Short(5000,3)
         -S4: Trade2 open MARKET LONG(3)

         -S5: Trade3 open Limit SHORT(5010,5)
         -S6: Trade1 open MARKET LONG(4)
         -S7: Trade0 open Limit Short(5020,2)=> have 1
         -S8: Trade1 open MARKET LONG(2)

         -S9: Trade2 open MARKET SHORT(1)
         -S10: Trade3 open Limit long(4970,2)
         -S11: Trade4 open Market SHORT(5)

         - S12: Trade(ps1) open Limit LONG(4950,2)
         - S13: Trade(ps2) open Market SHORT(2)
         */

        it('PS_FUTU_22: Market reverse Market; Limit reverse Limit', async () => {

            // ******************************
            //-S1: Trade0 open Limit Long(4980,15)
            //-S2: Trade1 open Market SHORT(11)
            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4980,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 15,
                _trader: trader
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('11'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-11')
                }
            );


            // *****************************
            //-S3: Trade0 open Limit Short(5000,3)
            //-S4: Trade2 open MARKET LONG(3)
            let response2 = (await openLimitPositionAndExpect({
                limitPrice: 5000,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 3,
                _trader: trader
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('3'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('3')
                }
            );


            // *****************************
            //-S5: Trade3 open Limit SHORT(5010,5)
            //-S6: Trade1 open MARKET LONG(4)
            let response3 = (await openLimitPositionAndExpect({
                limitPrice: 5010,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 5,
                _trader: trader3
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('4'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-7')
                }
            );


            // *****************************
            //-S7: Trade0 open Limit Short(5020,2)=> have 1
            //-S8: Trade1 open MARKET LONG(2)
            let response4 = (await openLimitPositionAndExpect({
                limitPrice: 5020,
                side: SIDE.SHORT,
                leverage: 10,
                quantity: 2,
                _trader: trader
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.LONG,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5')
                }
            );

            // *****************************
            //-S9: Trade2 open Market Short(1)
            //-S10: Trade3 open Limit Long(4970, 2)
            //-S11: Trade4 open MARKET Short(5)
            await openMarketPosition({
                    quantity: BigNumber.from('1'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader2.address,
                    instanceTrader: trader2,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('2')
                }
            );

            let response5 = (await openLimitPositionAndExpect({
                limitPrice: 4970,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 2,
                _trader: trader3
            })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader4.address,
                    instanceTrader: trader4,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5')
                }
            );

            await changePrice({
                limitPrice: 4950,
                toHigherPrice: false
            })

            const positionNotionalAndPnLTrader0 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader.address,
                1
            )
            const positionTrader0 = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData
            expect(positionTrader0.openNotional.div((10000))).eq(54780);
            expect(positionTrader0.quantity.div((10000))).eq(11)
            expect(positionTrader0.margin.div((10000))).eq(5478);
            expect(positionNotionalAndPnLTrader0.unrealizedPnl.div(10000)).eq(-330)


            const positionNotionalAndPnLTrader1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader1.address,
                1
            )
            const positionTrader1 = (await positionHouse.getPosition(positionManager.address, trader1.address)) as unknown as PositionData
            expect(positionTrader1.openNotional.div((10000))).eq(89190);
            expect(positionTrader1.margin.div((10000))).eq(8919);
            expect(positionNotionalAndPnLTrader1.unrealizedPnl.div(10000)).eq(-810)

            const positionNotionalAndPnLTrader2 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader2.address,
                1
            )
            const positionTrader2 = (await positionHouse.getPosition(positionManager.address, trader2.address)) as unknown as PositionData
            expect(positionTrader2.openNotional.div((10000))).eq(44350);
            expect(positionTrader2.margin.div((10000))).eq(4435);
            expect(positionNotionalAndPnLTrader2.unrealizedPnl.div(10000)).eq(650)

            const positionNotionalAndPnLTrader3 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader3.address,
                1
            )
            const positionTrader3 = (await positionHouse.getPosition(positionManager.address, trader3.address)) as unknown as PositionData
            expect(positionTrader3.openNotional.div((10000))).eq(24400);
            expect(positionTrader3.margin.div((10000))).eq(2440);
            expect(positionNotionalAndPnLTrader3.unrealizedPnl.div(10000)).eq(-600)

        })

    })

    describe('openReversePosition old Quantity > new quantity  (Market reverse Market; Limit reverse Limit)', async () => {

        /**
         * Code: FS_FUTU_26
         - S0: start price 5000
         - S1: Trade1 open limit LONG with (4990,5)
         - S2: Trade0 open MARKET SHORT (5)
         - S3: Trader2 open limit SHORT with (5010, 1)
         - S4: Trader3 open market LONG (1)
         - S5: Trade0 open limit LONG (5005,2)
         - S6: Trade1 open reverse MARKET position SHORT( 2)


         - S7: Tradecp open Limit LONG(5000,2)
         - S8: Tradecp open MARKET SHORT(2)
         */
        it('Limit reverse market', async () => {

            let response1 = (await openLimitPositionAndExpect({
                limitPrice: 4990,
                side: SIDE.LONG,
                leverage: 10,
                quantity: 5,
                _trader: trader1
            })) as unknown as PositionLimitOrderID
            console.log("line 246")

            await openMarketPosition({
                    quantity: BigNumber.from('5'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader.address,
                    instanceTrader: trader,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('-5')
                }
            );

            await changePrice({limitPrice: 5010, toHigherPrice: true})

            await positionHouse.connect(trader).closeLimitPosition(positionManager.address, priceToPip(Number(5005)), 2);

            // let response2 = (await openLimitPositionAndExpect({
            //     limitPrice: 5005,
            //     side: SIDE.LONG,
            //     leverage: 10,
            //     quantity: 2
            // })) as unknown as PositionLimitOrderID

            await openMarketPosition({
                    quantity: BigNumber.from('2'),
                    leverage: 10,
                    side: SIDE.SHORT,
                    trader: trader1.address,
                    instanceTrader: trader1,
                    _positionManager: positionManager,
                    expectedSize: BigNumber.from('3')
                }
            );

            const dataClaimTrader1 = (await positionHouse.canClaimFund(positionManager.address, trader1.address)) as unknown as ClaimFund;
            expect(dataClaimTrader1.amount.div(10000)).eq(968);
            expect(dataClaimTrader1.canClaim).eq(true);


            await changePrice({limitPrice: 5000, toHigherPrice: false})


            const positionData1 = (await positionHouse.getPosition(positionManager.address, trader.address)) as unknown as PositionData;
            const positionNotionalAndPnL1 = await positionHouse.getPositionNotionalAndUnrealizedPnl(
                positionManager.address,
                trader.address,
                1
            )
            expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).eq(-30)


            // expect(positionData1.openNotional.div(10000)).eq(14970)
            // expect(positionData1.margin.div(10000)).eq(1497)
            expect(positionNotionalAndPnL1.unrealizedPnl.div(10000)).eq(-30)


        })

    })

    // describe('reduce size position', async function () {
    //
    //
    //     it('reduce size by reverse limit order', async function () {
    //
    //
    //     })
    //
    //
    // })

})