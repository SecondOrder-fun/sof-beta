# Sample Translation Files for SecondOrder.fun

This document provides complete sample translation files for English and Japanese to kickstart the i18n implementation.

## Common Translations

### `public/locales/en/common.json`

```json
{
  "actions": {
    "connect": "Connect",
    "disconnect": "Disconnect",
    "buy": "Buy",
    "sell": "Sell",
    "claim": "Claim",
    "approve": "Approve",
    "confirm": "Confirm",
    "cancel": "Cancel",
    "submit": "Submit",
    "close": "Close",
    "retry": "Retry",
    "refresh": "Refresh",
    "copy": "Copy",
    "copied": "Copied!",
    "viewDetails": "View Details",
    "learnMore": "Learn More"
  },
  "status": {
    "loading": "Loading...",
    "processing": "Processing...",
    "success": "Success",
    "error": "Error",
    "pending": "Pending",
    "completed": "Completed",
    "failed": "Failed",
    "active": "Active",
    "inactive": "Inactive",
    "connected": "Connected",
    "disconnected": "Disconnected"
  },
  "time": {
    "seconds": "seconds",
    "minutes": "minutes",
    "hours": "hours",
    "days": "days",
    "startsIn": "Starts in",
    "endsIn": "Ends in",
    "timeRemaining": "Time Remaining",
    "expired": "Expired"
  },
  "units": {
    "sof": "SOF",
    "tickets": "Tickets",
    "ticket": "Ticket",
    "eth": "ETH",
    "usd": "USD"
  }
}
```

### `public/locales/ja/common.json`

```json
{
  "actions": {
    "connect": "接続",
    "disconnect": "切断",
    "buy": "購入",
    "sell": "売却",
    "claim": "請求",
    "approve": "承認",
    "confirm": "確認",
    "cancel": "キャンセル",
    "submit": "送信",
    "close": "閉じる",
    "retry": "再試行",
    "refresh": "更新",
    "copy": "コピー",
    "copied": "コピーしました！",
    "viewDetails": "詳細を見る",
    "learnMore": "詳しく見る"
  },
  "status": {
    "loading": "読み込み中...",
    "processing": "処理中...",
    "success": "成功",
    "error": "エラー",
    "pending": "保留中",
    "completed": "完了",
    "failed": "失敗",
    "active": "アクティブ",
    "inactive": "非アクティブ",
    "connected": "接続済み",
    "disconnected": "切断済み"
  },
  "time": {
    "seconds": "秒",
    "minutes": "分",
    "hours": "時間",
    "days": "日",
    "startsIn": "開始まで",
    "endsIn": "終了まで",
    "timeRemaining": "残り時間",
    "expired": "期限切れ"
  },
  "units": {
    "sof": "SOF",
    "tickets": "チケット",
    "ticket": "チケット",
    "eth": "ETH",
    "usd": "USD"
  }
}
```

## Navigation Translations

### `public/locales/en/navigation.json`

```json
{
  "brandName": "SecondOrder.fun",
  "menu": {
    "raffles": "Raffles",
    "predictionMarkets": "Prediction Markets",
    "users": "Users",
    "admin": "Admin",
    "myAccount": "My Account",
    "betaFaucets": "Beta Faucets"
  },
  "footer": {
    "copyright": "© 2025 SecondOrder.fun. All rights reserved.",
    "documentation": "Documentation",
    "github": "GitHub",
    "discord": "Discord",
    "twitter": "Twitter"
  },
  "network": {
    "local": "Local",
    "testnet": "Testnet",
    "mainnet": "Mainnet",
    "switchNetwork": "Switch Network",
    "notConfigured": "Testnet RPC not configured"
  }
}
```

### `public/locales/ja/navigation.json`

```json
{
  "brandName": "SecondOrder.fun",
  "menu": {
    "raffles": "ラッフル",
    "predictionMarkets": "予測市場",
    "users": "ユーザー",
    "admin": "管理者",
    "myAccount": "マイアカウント",
    "betaFaucets": "ベータ版フォーセット"
  },
  "footer": {
    "copyright": "© 2025 SecondOrder.fun. 全著作権所有。",
    "documentation": "ドキュメント",
    "github": "GitHub",
    "discord": "Discord",
    "twitter": "Twitter"
  },
  "network": {
    "local": "ローカル",
    "testnet": "テストネット",
    "mainnet": "メインネット",
    "switchNetwork": "ネットワーク切替",
    "notConfigured": "テストネットRPCが未設定です"
  }
}
```

## Raffle Translations

### `public/locales/en/raffle.json`

```json
{
  "title": "Raffles",
  "subtitle": "Fair games through transparent rules",
  "season": {
    "current": "Current Season",
    "upcoming": "Upcoming Season",
    "ended": "Ended Season",
    "seasonNumber": "Season {{number}}",
    "details": "Season Details",
    "status": "Status",
    "participants": "Participants",
    "totalTickets": "Total Tickets",
    "prizePool": "Prize Pool",
    "grandPrize": "Grand Prize",
    "consolationPool": "Consolation Pool"
  },
  "tickets": {
    "yourTickets": "Your Tickets",
    "buyTickets": "Buy Tickets",
    "sellTickets": "Sell Tickets",
    "ticketRange": "Ticket Range",
    "winProbability": "Win Probability",
    "amountToBuy": "Amount to Buy",
    "amountToSell": "Amount to Sell",
    "maxSlippage": "Max Slippage",
    "estimatedCost": "Estimated Cost",
    "estimatedProceeds": "Estimated Proceeds"
  },
  "position": {
    "yourPosition": "Your Current Position",
    "noPosition": "You don't have any tickets yet",
    "positionSize": "Position Size",
    "entryPrice": "Entry Price",
    "currentValue": "Current Value"
  },
  "bondingCurve": {
    "title": "Bonding Curve",
    "currentPrice": "Current Price",
    "currentStep": "Current Step",
    "progress": "Progress",
    "totalSupply": "Total Supply",
    "maxSupply": "Max Supply",
    "totalValueLocked": "Total Value Locked"
  },
  "messages": {
    "approveSuccess": "SOF approval successful",
    "buySuccess": "Tickets purchased successfully",
    "sellSuccess": "Tickets sold successfully",
    "insufficientBalance": "Insufficient SOF balance",
    "insufficientTickets": "Insufficient ticket balance",
    "seasonNotActive": "Season is not active",
    "tradingLocked": "Trading is locked"
  }
}
```

### `public/locales/ja/raffle.json`

```json
{
  "title": "ラッフル",
  "subtitle": "透明なルールによる公正なゲーム",
  "season": {
    "current": "現在のシーズン",
    "upcoming": "次回のシーズン",
    "ended": "終了したシーズン",
    "seasonNumber": "シーズン {{number}}",
    "details": "シーズン詳細",
    "status": "ステータス",
    "participants": "参加者",
    "totalTickets": "総チケット数",
    "prizePool": "賞金プール",
    "grandPrize": "大賞",
    "consolationPool": "慰労金プール"
  },
  "tickets": {
    "yourTickets": "あなたのチケット",
    "buyTickets": "チケット購入",
    "sellTickets": "チケット売却",
    "ticketRange": "チケット範囲",
    "winProbability": "当選確率",
    "amountToBuy": "購入数量",
    "amountToSell": "売却数量",
    "maxSlippage": "最大スリッページ",
    "estimatedCost": "推定コスト",
    "estimatedProceeds": "推定収益"
  },
  "position": {
    "yourPosition": "現在のポジション",
    "noPosition": "まだチケットをお持ちではありません",
    "positionSize": "ポジションサイズ",
    "entryPrice": "エントリー価格",
    "currentValue": "現在の価値"
  },
  "bondingCurve": {
    "title": "ボンディングカーブ",
    "currentPrice": "現在価格",
    "currentStep": "現在のステップ",
    "progress": "進捗",
    "totalSupply": "総供給量",
    "maxSupply": "最大供給量",
    "totalValueLocked": "ロック総額"
  },
  "messages": {
    "approveSuccess": "SOF承認が成功しました",
    "buySuccess": "チケット購入が成功しました",
    "sellSuccess": "チケット売却が成功しました",
    "insufficientBalance": "SOF残高が不足しています",
    "insufficientTickets": "チケット残高が不足しています",
    "seasonNotActive": "シーズンがアクティブではありません",
    "tradingLocked": "取引がロックされています"
  }
}
```

## Market Translations

### `public/locales/en/market.json`

```json
{
  "title": "Prediction Markets",
  "subtitle": "Information finance meets game theory",
  "types": {
    "winnerPrediction": "Winner Prediction",
    "positionSize": "Position Size",
    "behavioral": "Behavioral"
  },
  "market": {
    "marketId": "Market ID",
    "player": "Player",
    "probability": "Probability",
    "volume": "Volume",
    "liquidity": "Liquidity",
    "outcome": "Outcome",
    "yes": "YES",
    "no": "NO",
    "placeBet": "Place Bet",
    "yourBets": "Your Bets",
    "totalBets": "Total Bets",
    "potentialWinnings": "Potential Winnings"
  },
  "arbitrage": {
    "title": "Arbitrage Opportunities",
    "noOpportunities": "No arbitrage opportunities detected",
    "profitability": "Profitability",
    "estimatedProfit": "Estimated Profit",
    "rafflePrice": "Raffle Price",
    "marketPrice": "Market Price",
    "spread": "Spread",
    "strategy": "Strategy",
    "execute": "Execute Arbitrage"
  },
  "positions": {
    "title": "Your Positions",
    "noPositions": "You don't have any positions yet",
    "market": "Market",
    "outcome": "Outcome",
    "amount": "Amount",
    "currentValue": "Current Value",
    "profitLoss": "Profit/Loss"
  },
  "settlement": {
    "title": "Settlement Status",
    "pending": "Pending Settlement",
    "resolved": "Resolved",
    "winner": "Winner",
    "claimWinnings": "Claim Winnings",
    "winnings": "Winnings",
    "claimed": "Claimed"
  },
  "messages": {
    "betPlaced": "Bet placed successfully",
    "marketCreated": "Market created successfully",
    "winningsClaimed": "Winnings claimed successfully",
    "insufficientFunds": "Insufficient funds",
    "marketNotActive": "Market is not active",
    "alreadyClaimed": "Already claimed"
  }
}
```

### `public/locales/ja/market.json`

```json
{
  "title": "予測市場",
  "subtitle": "情報金融とゲーム理論の融合",
  "types": {
    "winnerPrediction": "勝者予測",
    "positionSize": "ポジションサイズ",
    "behavioral": "行動予測"
  },
  "market": {
    "marketId": "マーケットID",
    "player": "プレイヤー",
    "probability": "確率",
    "volume": "取引量",
    "liquidity": "流動性",
    "outcome": "結果",
    "yes": "はい",
    "no": "いいえ",
    "placeBet": "ベットする",
    "yourBets": "あなたのベット",
    "totalBets": "総ベット数",
    "potentialWinnings": "予想獲得額"
  },
  "arbitrage": {
    "title": "アービトラージ機会",
    "noOpportunities": "アービトラージ機会は検出されませんでした",
    "profitability": "収益性",
    "estimatedProfit": "推定利益",
    "rafflePrice": "ラッフル価格",
    "marketPrice": "市場価格",
    "spread": "スプレッド",
    "strategy": "戦略",
    "execute": "アービトラージ実行"
  },
  "positions": {
    "title": "あなたのポジション",
    "noPositions": "まだポジションがありません",
    "market": "マーケット",
    "outcome": "結果",
    "amount": "数量",
    "currentValue": "現在の価値",
    "profitLoss": "損益"
  },
  "settlement": {
    "title": "決済ステータス",
    "pending": "決済待ち",
    "resolved": "決済済み",
    "winner": "勝者",
    "claimWinnings": "賞金を請求",
    "winnings": "賞金",
    "claimed": "請求済み"
  },
  "messages": {
    "betPlaced": "ベットが成功しました",
    "marketCreated": "マーケット作成が成功しました",
    "winningsClaimed": "賞金請求が成功しました",
    "insufficientFunds": "資金が不足しています",
    "marketNotActive": "マーケットがアクティブではありません",
    "alreadyClaimed": "既に請求済みです"
  }
}
```

## Admin Translations

### `public/locales/en/admin.json`

```json
{
  "title": "Admin Panel",
  "subtitle": "Season management and system controls",
  "season": {
    "create": "Create Season",
    "start": "Start Season",
    "end": "End Season",
    "requestEnd": "Request Season End",
    "seasonConfig": "Season Configuration",
    "maxTickets": "Max Tickets",
    "ticketPrice": "Ticket Price",
    "startTime": "Start Time",
    "duration": "Duration",
    "grandPrizeBps": "Grand Prize (bps)",
    "winnerCount": "Winner Count"
  },
  "health": {
    "title": "System Health",
    "status": "Status",
    "healthy": "Healthy",
    "degraded": "Degraded",
    "unhealthy": "Unhealthy",
    "rpcConnection": "RPC Connection",
    "contractStatus": "Contract Status",
    "lastUpdate": "Last Update"
  },
  "transactions": {
    "title": "Transaction Status",
    "pending": "Pending Transactions",
    "recent": "Recent Transactions",
    "hash": "Transaction Hash",
    "type": "Type",
    "status": "Status",
    "timestamp": "Timestamp",
    "viewOnExplorer": "View on Explorer"
  },
  "vrf": {
    "title": "VRF Status",
    "requestId": "Request ID",
    "fulfilled": "Fulfilled",
    "randomWords": "Random Words",
    "fulfillManually": "Fulfill Manually"
  },
  "messages": {
    "seasonCreated": "Season created successfully",
    "seasonStarted": "Season started successfully",
    "seasonEnded": "Season end requested successfully",
    "vrfFulfilled": "VRF fulfilled successfully",
    "unauthorized": "Unauthorized access",
    "operationFailed": "Operation failed"
  }
}
```

### `public/locales/ja/admin.json`

```json
{
  "title": "管理者パネル",
  "subtitle": "シーズン管理とシステム制御",
  "season": {
    "create": "シーズン作成",
    "start": "シーズン開始",
    "end": "シーズン終了",
    "requestEnd": "シーズン終了リクエスト",
    "seasonConfig": "シーズン設定",
    "maxTickets": "最大チケット数",
    "ticketPrice": "チケット価格",
    "startTime": "開始時刻",
    "duration": "期間",
    "grandPrizeBps": "大賞（bps）",
    "winnerCount": "当選者数"
  },
  "health": {
    "title": "システムヘルス",
    "status": "ステータス",
    "healthy": "正常",
    "degraded": "低下",
    "unhealthy": "異常",
    "rpcConnection": "RPC接続",
    "contractStatus": "コントラクトステータス",
    "lastUpdate": "最終更新"
  },
  "transactions": {
    "title": "トランザクションステータス",
    "pending": "保留中のトランザクション",
    "recent": "最近のトランザクション",
    "hash": "トランザクションハッシュ",
    "type": "タイプ",
    "status": "ステータス",
    "timestamp": "タイムスタンプ",
    "viewOnExplorer": "エクスプローラーで見る"
  },
  "vrf": {
    "title": "VRFステータス",
    "requestId": "リクエストID",
    "fulfilled": "完了済み",
    "randomWords": "ランダムワード",
    "fulfillManually": "手動で完了"
  },
  "messages": {
    "seasonCreated": "シーズン作成が成功しました",
    "seasonStarted": "シーズン開始が成功しました",
    "seasonEnded": "シーズン終了リクエストが成功しました",
    "vrfFulfilled": "VRF完了が成功しました",
    "unauthorized": "アクセス権限がありません",
    "operationFailed": "操作が失敗しました"
  }
}
```

## Account Translations

### `public/locales/en/account.json`

```json
{
  "title": "My Account",
  "subtitle": "Your activity and statistics",
  "wallet": {
    "address": "Wallet Address",
    "balance": "Balance",
    "sofBalance": "SOF Balance",
    "ethBalance": "ETH Balance",
    "connected": "Connected",
    "notConnected": "Not Connected",
    "connectWallet": "Connect Wallet"
  },
  "activity": {
    "title": "Activity",
    "raffleParticipation": "Raffle Participation",
    "marketPositions": "Market Positions",
    "totalWinnings": "Total Winnings",
    "totalSpent": "Total Spent",
    "netProfit": "Net Profit"
  },
  "history": {
    "title": "History",
    "raffles": "Raffle History",
    "markets": "Market History",
    "transactions": "Transaction History",
    "noHistory": "No history yet"
  },
  "prizes": {
    "title": "Prizes",
    "unclaimed": "Unclaimed Prizes",
    "claimed": "Claimed Prizes",
    "claimAll": "Claim All",
    "noPrizes": "No prizes to claim"
  }
}
```

### `public/locales/ja/account.json`

```json
{
  "title": "マイアカウント",
  "subtitle": "あなたのアクティビティと統計",
  "wallet": {
    "address": "ウォレットアドレス",
    "balance": "残高",
    "sofBalance": "SOF残高",
    "ethBalance": "ETH残高",
    "connected": "接続済み",
    "notConnected": "未接続",
    "connectWallet": "ウォレット接続"
  },
  "activity": {
    "title": "アクティビティ",
    "raffleParticipation": "ラッフル参加",
    "marketPositions": "マーケットポジション",
    "totalWinnings": "総獲得額",
    "totalSpent": "総支出額",
    "netProfit": "純利益"
  },
  "history": {
    "title": "履歴",
    "raffles": "ラッフル履歴",
    "markets": "マーケット履歴",
    "transactions": "トランザクション履歴",
    "noHistory": "履歴がありません"
  },
  "prizes": {
    "title": "賞金",
    "unclaimed": "未請求の賞金",
    "claimed": "請求済みの賞金",
    "claimAll": "すべて請求",
    "noPrizes": "請求する賞金がありません"
  }
}
```

## Error Messages

### `public/locales/en/errors.json`

```json
{
  "general": {
    "unknown": "An unknown error occurred",
    "networkError": "Network error. Please try again.",
    "timeout": "Request timed out",
    "notFound": "Resource not found"
  },
  "wallet": {
    "notConnected": "Please connect your wallet",
    "wrongNetwork": "Please switch to the correct network",
    "insufficientBalance": "Insufficient balance",
    "userRejected": "Transaction rejected by user",
    "transactionFailed": "Transaction failed"
  },
  "contract": {
    "executionReverted": "Contract execution reverted",
    "gasEstimationFailed": "Gas estimation failed",
    "invalidParameters": "Invalid parameters",
    "unauthorized": "Unauthorized access"
  },
  "validation": {
    "required": "This field is required",
    "invalidAmount": "Invalid amount",
    "amountTooLow": "Amount too low",
    "amountTooHigh": "Amount too high",
    "invalidAddress": "Invalid address"
  }
}
```

### `public/locales/ja/errors.json`

```json
{
  "general": {
    "unknown": "不明なエラーが発生しました",
    "networkError": "ネットワークエラー。もう一度お試しください。",
    "timeout": "リクエストがタイムアウトしました",
    "notFound": "リソースが見つかりません"
  },
  "wallet": {
    "notConnected": "ウォレットを接続してください",
    "wrongNetwork": "正しいネットワークに切り替えてください",
    "insufficientBalance": "残高が不足しています",
    "userRejected": "トランザクションがユーザーによって拒否されました",
    "transactionFailed": "トランザクションが失敗しました"
  },
  "contract": {
    "executionReverted": "コントラクト実行が失敗しました",
    "gasEstimationFailed": "ガス推定が失敗しました",
    "invalidParameters": "無効なパラメータです",
    "unauthorized": "アクセス権限がありません"
  },
  "validation": {
    "required": "この項目は必須です",
    "invalidAmount": "無効な数量です",
    "amountTooLow": "数量が少なすぎます",
    "amountTooHigh": "数量が多すぎます",
    "invalidAddress": "無効なアドレスです"
  }
}
```

## Transaction Messages

### `public/locales/en/transactions.json`

```json
{
  "status": {
    "pending": "Transaction pending...",
    "confirming": "Confirming transaction...",
    "confirmed": "Transaction confirmed",
    "failed": "Transaction failed"
  },
  "actions": {
    "approve": "Approving {{token}}...",
    "buy": "Buying {{amount}} tickets...",
    "sell": "Selling {{amount}} tickets...",
    "claim": "Claiming prize...",
    "bet": "Placing bet...",
    "createSeason": "Creating season...",
    "startSeason": "Starting season...",
    "endSeason": "Ending season..."
  },
  "messages": {
    "waitingForSignature": "Waiting for signature...",
    "broadcasting": "Broadcasting transaction...",
    "waitingForConfirmation": "Waiting for confirmation...",
    "viewOnExplorer": "View on explorer",
    "copyHash": "Copy transaction hash"
  }
}
```

### `public/locales/ja/transactions.json`

```json
{
  "status": {
    "pending": "トランザクション保留中...",
    "confirming": "トランザクション確認中...",
    "confirmed": "トランザクション確認済み",
    "failed": "トランザクション失敗"
  },
  "actions": {
    "approve": "{{token}}を承認中...",
    "buy": "{{amount}}チケットを購入中...",
    "sell": "{{amount}}チケットを売却中...",
    "claim": "賞金を請求中...",
    "bet": "ベット中...",
    "createSeason": "シーズン作成中...",
    "startSeason": "シーズン開始中...",
    "endSeason": "シーズン終了中..."
  },
  "messages": {
    "waitingForSignature": "署名待ち...",
    "broadcasting": "トランザクション送信中...",
    "waitingForConfirmation": "確認待ち...",
    "viewOnExplorer": "エクスプローラーで見る",
    "copyHash": "トランザクションハッシュをコピー"
  }
}
```

---

## Usage Examples

### Basic Translation

```jsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation('common');
  
  return <button>{t('actions.buy')}</button>;
}
```

### With Namespace

```jsx
import { useTranslation } from 'react-i18next';

function RaffleCard() {
  const { t } = useTranslation('raffle');
  
  return (
    <div>
      <h2>{t('season.current')}</h2>
      <p>{t('season.totalTickets')}: {tickets}</p>
    </div>
  );
}
```

### With Interpolation

```jsx
import { useTranslation } from 'react-i18next';

function TransactionToast() {
  const { t } = useTranslation('transactions');
  
  return <div>{t('actions.buy', { amount: 100 })}</div>;
  // English: "Buying 100 tickets..."
  // Japanese: "100チケットを購入中..."
}
```

### Multiple Namespaces

```jsx
import { useTranslation } from 'react-i18next';

function ComplexComponent() {
  const { t } = useTranslation(['common', 'raffle', 'errors']);
  
  return (
    <div>
      <button>{t('common:actions.buy')}</button>
      <p>{t('raffle:tickets.yourTickets')}</p>
      <span>{t('errors:wallet.insufficientBalance')}</span>
    </div>
  );
}
```

---

**Note**: These translations are comprehensive starting points. Professional review by native Japanese speakers is recommended before production deployment, especially for financial and legal terminology.
