# Prediction Market Smart Contract

A decentralized prediction market built on **Solana** using the **Anchor framework**. Users can create markets, place bets on Yes/No outcomes, resolve markets, and claim winnings proportionally minus a 1% platform fee.

## 🚀 Features

- ✅ **Create Markets**: Initialize prediction markets with custom questions and end times
- ✅ **Place Bets**: Bet native SOL on Yes or No outcomes before the betting period ends
- ✅ **Resolve Markets**: Authorized resolution authority sets the true outcome
- ✅ **Claim Winnings**: Winners automatically receive proportional payouts based on their bet size
- ✅ **Security Features**:
  - Time validation (can't bet after end time, can't resolve before end time)
  - Authorization checks (only resolution authority can resolve)
  - Zero-amount bet prevention
  - Claim-before-resolution prevention
  - Double-claim protection
  - Math overflow protection

## 🏗️ Architecture

### Core Components

1. **Market Account**: Stores market state (question, totals, resolution status, fee percentage)
2. **Bet Account**: Stores individual bet information (bettor, amount, outcome, claimed status)
3. **Instructions**:
   - `initialize_market`: Create a new prediction market
   - `place_bet`: Place a bet on Yes or No
   - `resolve_market`: Resolve the market with the true outcome
   - `claim_winnings`: Claim proportional winnings for winners

### Solana-Specific Concepts

#### Program Derived Addresses (PDAs)
- **Market PDA**: `[b"market", creator, question_hash]` - Ensures unique markets per creator/question
- **Bet PDA**: `[b"bet", market, bettor]` - Ensures unique bets per user/market

PDAs allow deterministic account addresses without needing keypairs, and the program can sign for these accounts using seeds.

#### Account Validation
Anchor uses constraints to validate accounts:
- `init`: Creates a new account
- `payer`: Who pays for account creation rent
- `space`: Account size in bytes
- `seeds`: PDA derivation seeds
- `bump`: PDA bump seed (stored for later use)

## 📋 Prerequisites

- **Rust** (latest stable version)
- **Solana CLI** (v1.18+)
- **Anchor** (v0.31+)
- **Node.js** (v18+) and **Yarn**
- **TypeScript** (for tests)

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd prediction-market
   ```

2. **Install dependencies**
   ```bash
   yarn install
   ```

3. **Install Anchor** (if not already installed)
   ```bash
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install latest
   avm use latest
   ```

4. **Build the program**
   ```bash
   anchor build
   ```

## 🧪 Testing

### Local Testing

Run the test suite on a local validator:

```bash
# Start local validator (in separate terminal)
solana-test-validator

# Run tests
anchor test
```

### Devnet Testing

Test on Solana devnet:

```bash
# Configure for devnet
solana config set --url devnet

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Run devnet tests
yarn test:devnet
```

See [DEPLOY_DEVNET.md](./DEPLOY_DEVNET.md) for detailed devnet deployment instructions.

## 📊 How It Works

### 1. Initialize Market
Creator sets:
- Question (e.g., "Will Bitcoin reach $100k by 2025?")
- End time for betting period
- Resolution authority (defaults to creator)

### 2. Place Bets
Users bet SOL on Yes or No before the end time:
- Each user can have one bet per market
- Bets are stored in individual Bet accounts
- Market totals are updated automatically

### 3. Resolve Market
After the end time, the resolution authority sets the true outcome (Yes or No).

### 4. Claim Winnings
Winners can claim their proportional share:
- **Payout Formula**: `(user_bet / winning_pool) × (total_pool - fee)`
- **Fee**: 1% deducted from total pool
- **Example**:
  - Total pool: 300 SOL
  - Yes bets: 100 SOL, No bets: 200 SOL
  - Fee (1%): 3 SOL
  - Pool after fee: 297 SOL
  - If Yes wins and user bet 50 SOL: `(50 / 100) × 297 = 148.5 SOL`

## 📁 Project Structure

```
prediction-market/
├── programs/
│   └── prediction-market/
│       └── src/
│           └── lib.rs          # Main program logic
├── tests/
│   └── prediction-market.ts   # Local test suite
├── test-devnet.ts              # Devnet test suite
├── migrations/
│   └── deploy.ts               # Deployment script
├── Anchor.toml                 # Anchor configuration
└── README.md                    # This file
```

## 🔒 Security Features

1. **Time Validation**
   - End time must be in future when creating market
   - Can't bet after end time
   - Can't resolve before end time

2. **Authorization**
   - Only resolution_authority can resolve market
   - Uses Anchor's `Signer` constraint to verify signatures

3. **Reentrancy Protection**
   - Native SOL transfers are atomic
   - No external calls after state changes
   - Claimed flag prevents double-claiming

4. **Math Overflow Protection**
   - All arithmetic uses `checked_add`, `checked_mul`, etc.
   - Returns `MathOverflow` error if overflow occurs

5. **Input Validation**
   - Prevents zero-amount bets
   - Prevents claiming before market resolution
   - Validates bettor matches bet account

## 📝 Account Structures

### Market Account
```rust
pub struct Market {
    pub creator: Pubkey,
    pub resolution_authority: Pubkey,
    pub question: String,
    pub end_time: i64,
    pub resolved: bool,
    pub outcome: Option<bool>,
    pub total_yes_bets: u64,
    pub total_no_bets: u64,
    pub fee_percentage: u16,  // In basis points (100 = 1%)
    pub bump: u8,
}
```

**Size**: ~305 bytes

### Bet Account
```rust
pub struct Bet {
    pub bettor: Pubkey,
    pub market: Pubkey,
    pub amount: u64,
    pub outcome: bool,
    pub claimed: bool,
    pub bump: u8,
}
```

**Size**: ~83 bytes

## 🚢 Deployment

### Local Deployment
```bash
anchor build
anchor deploy
```

### Devnet Deployment
```bash
anchor build
anchor deploy --provider.cluster devnet
```

See [DEPLOY_DEVNET.md](./DEPLOY_DEVNET.md) for complete instructions.

## 📚 Program ID

- **Localnet**: `3LHuBziG2Tp1UrxgoTAZDDbvDK46quk6T99kHkgt8UQg`
- **Devnet**: `3LHuBziG2Tp1UrxgoTAZDDbvDK46quk6T99kHkgt8UQg`

## 🧩 Usage Examples

### Initialize a Market
```typescript
const question = "Will Bitcoin reach $100k by 2025?";
const endTime = new BN(Date.now() / 1000 + 86400); // 24 hours from now
const questionHash = hashQuestionToArray(question);

await program.methods
  .initializeMarket(question, endTime, questionHash)
  .accounts({
    market: marketPDA,
    creator: creator.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Place a Bet
```typescript
const betAmount = new BN(1 * LAMPORTS_PER_SOL); // 1 SOL
const outcome = true; // Yes

await program.methods
  .placeBet(betAmount, outcome)
  .accounts({
    market: marketPDA,
    bet: betPDA,
    bettor: bettor.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([bettor])
  .rpc();
```

### Resolve Market
```typescript
const outcome = true; // Yes wins

await program.methods
  .resolveMarket(outcome)
  .accounts({
    market: marketPDA,
    resolutionAuthority: authority.publicKey,
  })
  .signers([authority])
  .rpc();
```

### Claim Winnings
```typescript
await program.methods
  .claimWinnings()
  .accounts({
    market: marketPDA,
    bet: betPDA,
    bettor: bettor.publicKey,
  })
  .signers([bettor])
  .rpc();
```

## 🧪 Test Coverage

The test suite covers:
- ✅ Market initialization
- ✅ Placing bets on both sides
- ✅ Market resolution
- ✅ Claiming winnings
- ✅ Error cases:
  - Betting after end time
  - Unauthorized resolution
  - Claiming without winning
  - Zero-amount bets
  - Claiming before resolution
  - Double claiming

## 📄 License

ISC

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📞 Support

For issues and questions, please open an issue on GitHub.

## 🔗 Links

- [Solana Documentation](https://docs.solana.com/)
- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Cookbook](https://solanacookbook.com/)

---

**Built with ❤️ using Solana and Anchor**
