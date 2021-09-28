/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { BigDecimal, BigInt, Bytes, TypedMap } from '@graphprotocol/graph-ts'
import { AccountCToken, Account, AccountCTokenTransaction, Market } from '../types/schema'
import { BIGDECIMAL_ZERO } from './constants'

export function exponentToBigDecimal(decimals: i32): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = 0; i < decimals; i++) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export let mantissaFactor = 18
export let cTokenDecimals = 8
export let mantissaFactorBD: BigDecimal = exponentToBigDecimal(18)
export let cTokenDecimalsBD: BigDecimal = exponentToBigDecimal(8)
export let zeroBD = BigDecimal.fromString('0')

export function createAccountCToken(
  cTokenStatsID: string,
  symbol: string,
  account: string,
  marketID: string,
): AccountCToken {
  let cTokenStats = new AccountCToken(cTokenStatsID)
  cTokenStats.symbol = symbol
  cTokenStats.market = marketID
  cTokenStats.account = account
  cTokenStats.accrualBlockNumber = BigInt.fromI32(0)
  cTokenStats.cTokenBalance = zeroBD
  cTokenStats.totalUnderlyingSupplied = zeroBD
  cTokenStats.totalUnderlyingRedeemed = zeroBD
  cTokenStats.accountBorrowIndex = zeroBD
  cTokenStats.totalUnderlyingBorrowed = zeroBD
  cTokenStats.totalUnderlyingRepaid = zeroBD
  cTokenStats.storedBorrowBalance = zeroBD
  cTokenStats.enteredMarket = false
  return cTokenStats
}

export function createAccount(accountID: string): Account {
  let account = new Account(accountID)
  account.countLiquidated = 0
  account.countLiquidator = 0
  account.hasBorrowed = false
  account.save()
  return account
}

export function updateCommonCTokenStats(
  marketID: string,
  marketSymbol: string,
  accountID: string,
  tx_hash: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt,
  logIndex: BigInt,
): AccountCToken {
  let cTokenStatsID = marketID.concat('-').concat(accountID)
  let cTokenStats = AccountCToken.load(cTokenStatsID)
  if (cTokenStats == null) {
    cTokenStats = createAccountCToken(cTokenStatsID, marketSymbol, accountID, marketID)
  }
  getOrCreateAccountCTokenTransaction(
    cTokenStatsID,
    tx_hash,
    timestamp,
    blockNumber,
    logIndex,
  )
  cTokenStats.accrualBlockNumber = blockNumber
  return cTokenStats as AccountCToken
}

export function getOrCreateAccountCTokenTransaction(
  accountID: string,
  tx_hash: Bytes,
  timestamp: BigInt,
  block: BigInt,
  logIndex: BigInt,
): AccountCTokenTransaction {
  let id = accountID
    .concat('-')
    .concat(tx_hash.toHexString())
    .concat('-')
    .concat(logIndex.toString())
  let transaction = AccountCTokenTransaction.load(id)

  if (transaction == null) {
    transaction = new AccountCTokenTransaction(id)
    transaction.account = accountID
    transaction.tx_hash = tx_hash
    transaction.timestamp = timestamp
    transaction.block = block
    transaction.logIndex = logIndex
    transaction.save()
  }

  return transaction as AccountCTokenTransaction
}

export function supplyBalanceUnderlying(
  cToken: AccountCToken,
  market: Market,
): BigDecimal {
  return cToken.cTokenBalance.times(market.exchangeRate)
}

export function borrowBalanceUnderlying(
  cToken: AccountCToken,
  market: Market,
): BigDecimal {
  if (cToken.accountBorrowIndex.equals(BIGDECIMAL_ZERO)) {
    return BIGDECIMAL_ZERO
  }
  return cToken.storedBorrowBalance
    .times(market.borrowIndex)
    .div(cToken.accountBorrowIndex)
}

export function tokenInEth(market: Market): BigDecimal {
  return market.collateralFactor.times(market.exchangeRate).times(market.underlyingPrice)
}

export function totalCollateralValueInEth(
  accountTokens: string[],
  markets: TypedMap<string, Market>,
  tokens: TypedMap<string, AccountCToken>,
): BigDecimal {
  let value = BIGDECIMAL_ZERO

  // `reduce` is not supported
  for (let i = 0; i < accountTokens.length; i++) {
    value = value.plus(
      tokenInEth(markets.get(accountTokens[i]) as Market).times(
        tokens.get(accountTokens[i]).cTokenBalance,
      ),
    )
  }
  return value
}

export function totalBorrowValueInEth(
  account: Account,
  accountTokens: string[],
  markets: TypedMap<string, Market>,
  tokens: TypedMap<string, AccountCToken>,
): BigDecimal {
  if (!account.hasBorrowed) {
    return BIGDECIMAL_ZERO
  }

  let value = BIGDECIMAL_ZERO

  // `reduce` is not supported
  for (let i = 0; i < accountTokens.length; i++) {
    let market = markets.get(accountTokens[i]) as Market
    value = value.plus(
      market.underlyingPrice.times(
        borrowBalanceUnderlying(tokens.get(accountTokens[i]) as AccountCToken, market),
      ),
    )
  }
  return value
}

export function health(
  account: Account,
  accountTokens: string[],
  markets: TypedMap<string, Market>,
  tokens: TypedMap<string, AccountCToken>,
): BigDecimal {
  if (!account.hasBorrowed) {
    return null
  }
  let totalBorrow = totalBorrowValueInEth(account, accountTokens, markets, tokens)
  if (totalBorrow.equals(BIGDECIMAL_ZERO)) {
    return totalCollateralValueInEth(accountTokens, markets, tokens)
  }
  return totalCollateralValueInEth(accountTokens, markets, tokens).div(totalBorrow)
}
