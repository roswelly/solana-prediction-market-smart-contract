/**
 * Comprehensive Devnet Test Script
 * 
 * This script tests all functionality of the Prediction Market smart contract on devnet.
 * Run with: ts-node test-devnet.ts
 * 
 * Prerequisites:
 * - Anchor program deployed to devnet
 * - Solana CLI configured for devnet
 * - Test accounts funded with devnet SOL
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, Idl } from "@coral-xyz/anchor";
import { PredictionMarket } from "./target/types/prediction_market";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  Connection,
  clusterApiUrl
} from "@solana/web3.js";
import * as crypto from "crypto";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import bs58 from "bs58";

// Configuration
const DEVNET_RPC = clusterApiUrl("devnet");
const PROGRAM_ID = new PublicKey("3LHuBziG2Tp1UrxgoTAZDDbvDK46quk6T99kHkgt8UQg");

// Helper function to hash question
const hashQuestion = (question: string): Buffer => {
  return crypto.createHash("sha256").update(question, "utf8").digest();
};

// Helper function to convert hash to array format
const hashQuestionToArray = (question: string): number[] => {
  const hashBuffer = hashQuestion(question);
  return Array.from(new Uint8Array(hashBuffer));
};

// Helper function to get market PDA
const getMarketPDA = (creator: PublicKey, question: string): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), hashQuestion(question)],
    PROGRAM_ID
  );
};

// Helper function to get bet PDA
const getBetPDA = (market: PublicKey, bettor: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), market.toBuffer(), bettor.toBuffer()],
    PROGRAM_ID
  );
};

// Helper to wait for confirmation
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to check balance (airdrops removed)
async function checkBalance(connection: Connection, address: PublicKey, label: string) {
  const balance = await connection.getBalance(address);
  console.log(`  💰 ${label} balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  return balance;
}

async function main() {
  console.log("🚀 Prediction Market Devnet Test Suite");
  console.log("=======================================\n");

  // Setup connection and provider
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  // Load wallet from default Solana config location
  // anchor.Wallet.local() requires ANCHOR_WALLET env var, so we load it manually
  const homeDir = process.env.HOME || "/root";
  const walletPath = process.env.ANCHOR_WALLET || 
                     path.join(homeDir, ".config", "solana", "id.json");
  
  // Store homeDir for later use in bettor keypair loading
  
  let wallet: anchor.Wallet;
  try {
    if (!fs.existsSync(walletPath)) {
      throw new Error(`Wallet file not found at ${walletPath}`);
    }
    const keypairData = JSON.parse(fs.readFileSync(walletPath, "utf8"));
    const secretKey = Uint8Array.from(keypairData);
    const keypair = Keypair.fromSecretKey(secretKey);
    wallet = new anchor.Wallet(keypair);
    console.log(`   ✅ Wallet loaded: ${wallet.publicKey.toString()}`);
  } catch (error: any) {
    console.error(`   ❌ Failed to load wallet: ${error.message}`);
    // Fallback: try anchor.Wallet.local() if env var is set
    try {
      wallet = anchor.Wallet.local();
      console.log(`   ✅ Using anchor.Wallet.local() as fallback`);
    } catch (fallbackError: any) {
      throw new Error(
        `Could not load wallet. Please ensure:\n` +
        `  1. Wallet exists at: ${walletPath}\n` +
        `  2. Or set ANCHOR_WALLET environment variable\n` +
        `  3. Or create a wallet: solana-keygen new\n` +
        `Error: ${fallbackError.message}`
      );
    }
  }
  
  const provider = new anchor.AnchorProvider(
    connection,
    wallet,
    anchor.AnchorProvider.defaultOptions()
  );
  anchor.setProvider(provider);

  console.log("📋 Configuration:");
  console.log(`   Program ID: ${PROGRAM_ID.toString()}`);
  console.log(`   RPC URL: ${DEVNET_RPC}`);
  console.log(`   Wallet: ${wallet.publicKey.toString()}`);
  console.log(`   Balance: ${(await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL} SOL\n`);

  // Check wallet balance
  await checkBalance(connection, wallet.publicKey, "Wallet");

  // Check if program is deployed to devnet
  console.log(`   Checking if program is deployed to devnet...`);
  try {
    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    if (!programInfo || !programInfo.executable) {
      throw new Error(
        `Program ${PROGRAM_ID.toString()} is not deployed to devnet.\n` +
        `Please deploy it first: anchor deploy --provider.cluster devnet`
      );
    }
    console.log(`   ✅ Program is deployed (executable: ${programInfo.executable})`);
  } catch (error: any) {
    if (error.message.includes("not deployed")) {
      throw error;
    }
    console.log(`   ⚠️  Could not verify program deployment: ${error.message}`);
  }

  // Load program using Anchor workspace (most reliable method)
  // The workspace uses Anchor.toml and automatically loads IDL with correct structure
  // Set environment variables so Anchor uses our devnet connection
  const originalProviderUrl = process.env.ANCHOR_PROVIDER_URL;
  const originalWallet = process.env.ANCHOR_WALLET;
  
  process.env.ANCHOR_PROVIDER_URL = DEVNET_RPC;
  process.env.ANCHOR_WALLET = walletPath;
  
  // Set the provider globally so workspace uses it
  anchor.setProvider(provider);
  
  // Load from workspace - this automatically loads the IDL with proper structure
  // The workspace reads from Anchor.toml and target/idl/ automatically
  const program = anchor.workspace.PredictionMarket as Program<PredictionMarket>;
  
  console.log(`   ✅ Program loaded from workspace`);
  
  // Restore environment variables
  if (originalProviderUrl) {
    process.env.ANCHOR_PROVIDER_URL = originalProviderUrl;
  } else {
    delete process.env.ANCHOR_PROVIDER_URL;
  }
  if (originalWallet) {
    process.env.ANCHOR_WALLET = originalWallet;
  } else {
    delete process.env.ANCHOR_WALLET;
  }

  // Create test accounts
  console.log("👥 Setting up test accounts...");
  const creator = wallet.publicKey;
  
  // Use specific bettor addresses
  const bettor1Pubkey = new PublicKey("9yzKkHuhYmZGXA1RyKj4fv64QhcPySNAoXk61w6cvnZD");
  const bettor2Pubkey = new PublicKey("Gy5UDBHpAtqZCq7MqKBoYnc6buqinJQ93qMjVSPM6u29");
  
  // Load keypairs from private keys or wallet files
  // Priority: 1) Environment variables (base58 private keys), 2) Wallet files, 3) Hardcoded keys
  let bettor1: Keypair;
  let bettor2: Keypair;
  
  // Helper function to decode base58 private key
  const decodeBase58PrivateKey = (base58Key: string): Uint8Array => {
    try {
      // Decode base58 private key
      const decoded = bs58.decode(base58Key);
      
      // Solana keypairs need 64 bytes (32 bytes private key + 32 bytes public key)
      // But base58 private keys are typically 32 bytes (just the secret key)
      // Keypair.fromSecretKey will derive the public key from the 32-byte secret key
      if (decoded.length === 64) {
        // Full keypair (secret + public)
        return decoded;
      } else if (decoded.length === 32) {
        // Just the secret key (32 bytes) - Keypair.fromSecretKey will derive public key
        return decoded;
      } else {
        throw new Error(`Invalid private key length: ${decoded.length} bytes (expected 32 or 64)`);
      }
    } catch (error: any) {
      throw new Error(`Failed to decode base58 private key: ${error.message}`);
    }
  };
  
  // Load bettor1 keypair
  try {
    // Option 1: From environment variable (base58 private key)
    const bettor1PrivateKey = process.env.BETTOR1_PRIVATE_KEY || "5ayYwwfefV6iFDdFdGA7wqpodq5j7rgKxp8XbyqTyYWSPGqmP1RbmtftgWquhuVFgNJJbvVBoncH41XhKruxwuN7";
    if (bettor1PrivateKey) {
      const secretKey = decodeBase58PrivateKey(bettor1PrivateKey);
      bettor1 = Keypair.fromSecretKey(secretKey);
      if (!bettor1.publicKey.equals(bettor1Pubkey)) {
        throw new Error(`Bettor1 public key mismatch. Expected ${bettor1Pubkey.toString()}, got ${bettor1.publicKey.toString()}`);
      }
      console.log(`   ✅ Loaded bettor1 keypair from private key`);
    } else {
      throw new Error("No bettor1 private key provided");
    }
  } catch (error: any) {
    // Fallback: Try wallet file
    const bettor1WalletPath = process.env.BETTOR1_WALLET || path.join(homeDir, ".config", "solana", "bettor1.json");
    if (fs.existsSync(bettor1WalletPath)) {
      try {
        const keypairData = JSON.parse(fs.readFileSync(bettor1WalletPath, "utf8"));
        bettor1 = Keypair.fromSecretKey(Uint8Array.from(keypairData));
        if (!bettor1.publicKey.equals(bettor1Pubkey)) {
          throw new Error(`Bettor1 wallet public key mismatch. Expected ${bettor1Pubkey.toString()}, got ${bettor1.publicKey.toString()}`);
        }
        console.log(`   ✅ Loaded bettor1 keypair from wallet file: ${bettor1WalletPath}`);
      } catch (fileError: any) {
        console.error(`   ❌ Failed to load bettor1 from wallet file: ${fileError.message}`);
        throw error; // Throw original error
      }
    } else {
      console.error(`   ❌ Could not load bettor1 keypair: ${error.message}`);
      throw error;
    }
  }
  
  // Load bettor2 keypair
  try {
    // Option 1: From environment variable (base58 private key)
    const bettor2PrivateKey = process.env.BETTOR2_PRIVATE_KEY || "x4yYRvbS3g3aBrTsH8YjTknZuTQHYWz21nuaBDCe57nHuSDK2Y554nFJxERWusv74DK6pih8pC7kC6GH8xwrLfj";
    if (bettor2PrivateKey) {
      const secretKey = decodeBase58PrivateKey(bettor2PrivateKey);
      bettor2 = Keypair.fromSecretKey(secretKey);
      if (!bettor2.publicKey.equals(bettor2Pubkey)) {
        throw new Error(`Bettor2 public key mismatch. Expected ${bettor2Pubkey.toString()}, got ${bettor2.publicKey.toString()}`);
      }
      console.log(`   ✅ Loaded bettor2 keypair from private key`);
    } else {
      throw new Error("No bettor2 private key provided");
    }
  } catch (error: any) {
    // Fallback: Try wallet file
    const bettor2WalletPath = process.env.BETTOR2_WALLET || path.join(homeDir, ".config", "solana", "bettor2.json");
    if (fs.existsSync(bettor2WalletPath)) {
      try {
        const keypairData = JSON.parse(fs.readFileSync(bettor2WalletPath, "utf8"));
        bettor2 = Keypair.fromSecretKey(Uint8Array.from(keypairData));
        if (!bettor2.publicKey.equals(bettor2Pubkey)) {
          throw new Error(`Bettor2 wallet public key mismatch. Expected ${bettor2Pubkey.toString()}, got ${bettor2.publicKey.toString()}`);
        }
        console.log(`   ✅ Loaded bettor2 keypair from wallet file: ${bettor2WalletPath}`);
      } catch (fileError: any) {
        console.error(`   ❌ Failed to load bettor2 from wallet file: ${fileError.message}`);
        throw error; // Throw original error
      }
    } else {
      console.error(`   ❌ Could not load bettor2 keypair: ${error.message}`);
      throw error;
    }
  }
  
  const unauthorized = Keypair.generate();

  console.log(`   Creator: ${creator.toString()}`);
  console.log(`   Bettor 1: ${bettor1.publicKey.toString()}`);
  console.log(`   Bettor 2: ${bettor2.publicKey.toString()}`);
  console.log(`   Unauthorized: ${unauthorized.publicKey.toString()}\n`);

  // Check test account balances
  console.log("💰 Checking test account balances...");
  const bettor1Balance = await checkBalance(connection, bettor1.publicKey, "Bettor 1");
  const bettor2Balance = await checkBalance(connection, bettor2.publicKey, "Bettor 2");
  await checkBalance(connection, unauthorized.publicKey, "Unauthorized");
  
  if (bettor1Balance < 0.1 * LAMPORTS_PER_SOL || bettor2Balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log(`\n   ⚠️  WARNING: Some test accounts have insufficient balance!`);
    console.log(`   Bettor 1: ${bettor1Balance / LAMPORTS_PER_SOL} SOL`);
    console.log(`   Bettor 2: ${bettor2Balance / LAMPORTS_PER_SOL} SOL`);
    console.log(`   💡 Please ensure accounts have sufficient SOL before running tests.\n`);
  }

  let testCount = 0;
  let passCount = 0;
  let failCount = 0;
  const transactionLinks: Array<{test: string, tx: string, status: string}> = [];

  // Helper to create Solscan link
  const getSolscanLink = (signature: string): string => {
    return `https://solscan.io/tx/${signature}?cluster=devnet`;
  };

  // Test helper
  async function runTest(name: string, testFn: () => Promise<string | undefined | void>) {
    testCount++;
    console.log(`\n${"=".repeat(70)}`);
    console.log(`📝 Test ${testCount}: ${name}`);
    console.log(`${"=".repeat(70)}`);
    try {
      const txSignature = await testFn();
      if (txSignature) {
        const solscanLink = getSolscanLink(txSignature);
        console.log(`\n   ✅ PASSED`);
        console.log(`   📄 Transaction: ${txSignature}`);
        console.log(`   🔗 Solscan: ${solscanLink}`);
        transactionLinks.push({ test: name, tx: txSignature, status: "PASSED" });
      } else {
        console.log(`\n   ✅ PASSED`);
        transactionLinks.push({ test: name, tx: "N/A", status: "PASSED" });
      }
      passCount++;
    } catch (error: any) {
      console.log(`\n   ❌ FAILED: ${error.message}`);
      if (error.logs) {
        console.log(`\n   📋 Program Logs:`);
        error.logs.forEach((log: string) => {
          console.log(`      ${log}`);
        });
      }
      if (error.signature) {
        const solscanLink = getSolscanLink(error.signature);
        console.log(`\n   📄 Transaction: ${error.signature}`);
        console.log(`   🔗 Solscan: ${solscanLink}`);
        transactionLinks.push({ test: name, tx: error.signature, status: "FAILED" });
      } else {
        transactionLinks.push({ test: name, tx: "N/A", status: "FAILED" });
      }
      failCount++;
    }
  }

  // ==========================================
  // TEST 1: Initialize Market
  // ==========================================
  await runTest("Initialize Market", async () => {
    const question = `Will Bitcoin reach $100k by 2025? Test ${Date.now()}`;
    const endTime = new BN(Date.now() / 1000 + 86400); // 24 hours from now
    const questionHash = hashQuestionToArray(question);
    const [marketPDA, bump] = getMarketPDA(creator, question);

    console.log(`   📌 Question: "${question}"`);
    console.log(`   ⏰ End Time: ${new Date(endTime.toNumber() * 1000).toISOString()}`);
    console.log(`   🔑 Market PDA: ${marketPDA.toString()}`);
    console.log(`   🔑 Bump: ${bump}`);

    const tx = await program.methods
      .initializeMarket(question, endTime, questionHash)
      .accounts({
        market: marketPDA,
        creator: creator,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    console.log(`   📤 Transaction sent: ${tx}`);
    console.log(`   🔗 View on Solscan: ${getSolscanLink(tx)}`);
    console.log(`   ⏳ Waiting for confirmation...`);

    // Wait for transaction confirmation
    await connection.confirmTransaction(tx, "confirmed");
    await sleep(1000);

    // Verify market was created
    const market = await program.account.market.fetch(marketPDA);
    console.log(`   ✅ Market account fetched`);
    console.log(`   📊 Market State:`);
    console.log(`      - Creator: ${market.creator.toString()}`);
    console.log(`      - Resolution Authority: ${market.resolutionAuthority.toString()}`);
    console.log(`      - Resolved: ${market.resolved}`);
    console.log(`      - Outcome: ${market.outcome === null ? "Not set" : market.outcome ? "Yes" : "No"}`);
    console.log(`      - Total Yes Bets: ${market.totalYesBets.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`      - Total No Bets: ${market.totalNoBets.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`      - Fee Percentage: ${market.feePercentage} basis points (${market.feePercentage / 100}%)`);

    if (market.question !== question) {
      throw new Error(`Market question mismatch: expected "${question}", got "${market.question}"`);
    }
    if (market.resolved !== false) {
      throw new Error("Market should not be resolved");
    }
    if (market.totalYesBets.toNumber() !== 0 || market.totalNoBets.toNumber() !== 0) {
      throw new Error("Initial bet totals should be zero");
    }

    return tx;
  });

  // ==========================================
  // TEST 2: Place Bet on Yes
  // ==========================================
  let testMarketPDA: PublicKey;
  await runTest("Place Bet on Yes", async () => {
    const question = `Test Market - Bet Yes ${Date.now()}`;
    const endTime = new BN(Date.now() / 1000 + 86400);
    const questionHash = hashQuestionToArray(question);
    [testMarketPDA] = getMarketPDA(creator, question);

    // Create market
    await program.methods
      .initializeMarket(question, endTime, questionHash)
      .accounts({
        market: testMarketPDA,
        creator: creator,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // Place bet
    const betAmount = new BN(1 * LAMPORTS_PER_SOL);
    const outcome = true; // Yes
    const [betPDA] = getBetPDA(testMarketPDA, bettor1.publicKey);

    console.log(`   💰 Placing bet:`);
    console.log(`      - Amount: ${betAmount.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`      - Outcome: ${outcome ? "Yes" : "No"}`);
    console.log(`      - Bettor: ${bettor1.publicKey.toString()}`);

    const tx = await program.methods
      .placeBet(betAmount, outcome)
      .accounts({
        market: testMarketPDA,
        bet: betPDA,
        bettor: bettor1.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([bettor1])
      .rpc();

    console.log(`   📤 Transaction sent: ${tx}`);
    console.log(`   🔗 View on Solscan: ${getSolscanLink(tx)}`);
    await connection.confirmTransaction(tx, "confirmed");
    await sleep(1000);

    // Verify bet
    const bet = await program.account.bet.fetch(betPDA);
    console.log(`   ✅ Bet account fetched`);
    console.log(`   📊 Bet State:`);
    console.log(`      - Amount: ${bet.amount.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`      - Outcome: ${bet.outcome ? "Yes" : "No"}`);
    console.log(`      - Claimed: ${bet.claimed}`);

    if (bet.amount.toNumber() !== betAmount.toNumber()) {
      throw new Error(`Bet amount mismatch: expected ${betAmount.toNumber()}, got ${bet.amount.toNumber()}`);
    }
    if (bet.outcome !== outcome) {
      throw new Error(`Bet outcome mismatch: expected ${outcome}, got ${bet.outcome}`);
    }

    // Verify market totals
    const market = await program.account.market.fetch(testMarketPDA);
    console.log(`   📊 Market Totals:`);
    console.log(`      - Total Yes Bets: ${market.totalYesBets.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`      - Total No Bets: ${market.totalNoBets.toNumber() / LAMPORTS_PER_SOL} SOL`);

    if (market.totalYesBets.toNumber() !== betAmount.toNumber()) {
      throw new Error(`Yes bets total mismatch: expected ${betAmount.toNumber()}, got ${market.totalYesBets.toNumber()}`);
    }

    return tx;
  });

  // ==========================================
  // TEST 3: Place Bet on No
  // ==========================================
  await runTest("Place Bet on No", async () => {
    const betAmount = new BN(0.5 * LAMPORTS_PER_SOL);
    const outcome = false; // No
    const [betPDA] = getBetPDA(testMarketPDA, bettor2.publicKey);

    console.log(`   💰 Placing bet:`);
    console.log(`      - Amount: ${betAmount.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`      - Outcome: ${outcome ? "Yes" : "No"}`);
    console.log(`      - Bettor: ${bettor2.publicKey.toString()}`);

    const tx = await program.methods
      .placeBet(betAmount, outcome)
      .accounts({
        market: testMarketPDA,
        bet: betPDA,
        bettor: bettor2.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([bettor2])
      .rpc();

    console.log(`   📤 Transaction sent: ${tx}`);
    console.log(`   🔗 View on Solscan: ${getSolscanLink(tx)}`);
    await connection.confirmTransaction(tx, "confirmed");
    await sleep(1000);

    // Verify bet
    const bet = await program.account.bet.fetch(betPDA);
    if (bet.outcome !== outcome) {
      throw new Error("Bet outcome mismatch");
    }

    // Verify market totals
    const market = await program.account.market.fetch(testMarketPDA);
    const expectedYes = 1 * LAMPORTS_PER_SOL;
    const expectedNo = 0.5 * LAMPORTS_PER_SOL;
    console.log(`   📊 Market Totals:`);
    console.log(`      - Total Yes Bets: ${market.totalYesBets.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`      - Total No Bets: ${market.totalNoBets.toNumber() / LAMPORTS_PER_SOL} SOL`);

    if (market.totalYesBets.toNumber() !== expectedYes) {
      throw new Error(`Yes bets mismatch: expected ${expectedYes}, got ${market.totalYesBets.toNumber()}`);
    }
    if (market.totalNoBets.toNumber() !== expectedNo) {
      throw new Error(`No bets mismatch: expected ${expectedNo}, got ${market.totalNoBets.toNumber()}`);
    }

    return tx;
  });

  // ==========================================
  // TEST 4: Prevent Zero Amount Bet
  // ==========================================
  await runTest("Prevent Zero Amount Bet", async () => {
    const betAmount = new BN(0);
    const outcome = true;
    const [betPDA] = getBetPDA(testMarketPDA, bettor1.publicKey);

    try {
      await program.methods
        .placeBet(betAmount, outcome)
        .accounts({
          market: testMarketPDA,
          bet: betPDA,
          bettor: bettor1.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([bettor1])
        .rpc();
      throw new Error("Should have thrown InvalidAmount error");
    } catch (error: any) {
      const errorCode = error.error?.errorCode?.code || error.errorCode?.code;
      if (errorCode !== "InvalidAmount") {
        throw new Error(`Expected InvalidAmount, got ${errorCode}`);
      }
      console.log(`   ✅ Correctly rejected zero amount bet`);
    }
    return undefined; // No transaction for error test
  });

  // ==========================================
  // TEST 5: Resolve Market
  // ==========================================
  let resolvedMarketPDA: PublicKey;
  await runTest("Resolve Market", async () => {
    // Create a market that can be resolved
    const question = `Resolvable Market ${Date.now()}`;
    const pastEndTime = new BN(Date.now() / 1000 - 3600); // 1 hour ago
    const questionHash = hashQuestionToArray(question);
    [resolvedMarketPDA] = getMarketPDA(creator, question);

    // Create market
    await program.methods
      .initializeMarket(question, pastEndTime, questionHash)
      .accounts({
        market: resolvedMarketPDA,
        creator: creator,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // Place some bets
    const [bet1PDA] = getBetPDA(resolvedMarketPDA, bettor1.publicKey);
    await program.methods
      .placeBet(new BN(1 * LAMPORTS_PER_SOL), true)
      .accounts({
        market: resolvedMarketPDA,
        bet: bet1PDA,
        bettor: bettor1.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([bettor1])
      .rpc();

    // Resolve market (Yes wins)
    const outcome = true;
    console.log(`   🎯 Resolving market:`);
    console.log(`      - Outcome: ${outcome ? "Yes" : "No"}`);
    console.log(`      - Resolution Authority: ${creator.toString()}`);

    const tx = await program.methods
      .resolveMarket(outcome)
      .accounts({
        market: resolvedMarketPDA,
        resolutionAuthority: creator,
      } as any)
      .rpc();

    console.log(`   📤 Transaction sent: ${tx}`);
    console.log(`   🔗 View on Solscan: ${getSolscanLink(tx)}`);
    await connection.confirmTransaction(tx, "confirmed");
    await sleep(1000);

    // Verify resolution
    const market = await program.account.market.fetch(resolvedMarketPDA);
    console.log(`   ✅ Market account fetched`);
    console.log(`   📊 Market State After Resolution:`);
    console.log(`      - Resolved: ${market.resolved}`);
    console.log(`      - Outcome: ${market.outcome === null ? "Not set" : market.outcome ? "Yes" : "No"}`);
    if (!market.resolved) {
      throw new Error("Market should be resolved");
    }
    const actualOutcome = market.outcome === null ? null : (market.outcome === true ? true : false);
    if (actualOutcome !== outcome) {
      throw new Error(`Market outcome mismatch: expected ${outcome}, got ${actualOutcome}`);
    }

    return tx;
  });

  // ==========================================
  // TEST 6: Prevent Claim Before Resolution
  // ==========================================
  await runTest("Prevent Claim Before Resolution", async () => {
    const question = `Unresolved Market ${Date.now()}`;
    const endTime = new BN(Date.now() / 1000 + 86400);
    const questionHash = hashQuestionToArray(question);
    const [unresolvedMarketPDA] = getMarketPDA(creator, question);

    // Create market and place bet
    await program.methods
      .initializeMarket(question, endTime, questionHash)
      .accounts({
        market: unresolvedMarketPDA,
        creator: creator,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const [betPDA] = getBetPDA(unresolvedMarketPDA, bettor1.publicKey);
    await program.methods
      .placeBet(new BN(1 * LAMPORTS_PER_SOL), true)
      .accounts({
        market: unresolvedMarketPDA,
        bet: betPDA,
        bettor: bettor1.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([bettor1])
      .rpc();

    // Try to claim before resolution
    try {
      await program.methods
        .claimWinnings()
        .accounts({
          market: unresolvedMarketPDA,
          bet: betPDA,
          bettor: bettor1.publicKey,
        } as any)
        .signers([bettor1])
        .rpc();
      throw new Error("Should have thrown MarketNotResolved error");
    } catch (error: any) {
      const errorCode = error.error?.errorCode?.code || error.errorCode?.code;
      if (errorCode !== "MarketNotResolved") {
        throw new Error(`Expected MarketNotResolved, got ${errorCode}`);
      }
      console.log(`   ✅ Correctly prevented claim before resolution`);
    }
    return undefined; // No transaction for error test
  });

  // ==========================================
  // TEST 7: Claim Winnings
  // ==========================================
  await runTest("Claim Winnings", async () => {
    const [betPDA] = getBetPDA(resolvedMarketPDA, bettor1.publicKey);
    
    // Get balance before
    const balanceBefore = await connection.getBalance(bettor1.publicKey);

    // Claim winnings
    console.log(`   💰 Claiming winnings:`);
    console.log(`      - Bettor: ${bettor1.publicKey.toString()}`);
    console.log(`      - Market: ${resolvedMarketPDA.toString()}`);
    console.log(`      - Balance before: ${balanceBefore / LAMPORTS_PER_SOL} SOL`);

    const tx = await program.methods
      .claimWinnings()
      .accounts({
        market: resolvedMarketPDA,
        bet: betPDA,
        bettor: bettor1.publicKey,
      } as any)
      .signers([bettor1])
      .rpc();

    console.log(`   📤 Transaction sent: ${tx}`);
    console.log(`   🔗 View on Solscan: ${getSolscanLink(tx)}`);
    await connection.confirmTransaction(tx, "confirmed");
    await sleep(2000);

    // Verify bet is marked as claimed
    const bet = await program.account.bet.fetch(betPDA);
    if (!bet.claimed) {
      throw new Error("Bet should be marked as claimed");
    }

    // Check balance increased (rough check)
    const balanceAfter = await connection.getBalance(bettor1.publicKey);
    const balanceIncrease = balanceAfter - balanceBefore;
    console.log(`   ✅ Balance after: ${balanceAfter / LAMPORTS_PER_SOL} SOL`);
    console.log(`   📊 Balance increase: ${balanceIncrease / LAMPORTS_PER_SOL} SOL`);
    
    if (balanceIncrease <= 0) {
      throw new Error("Balance should have increased");
    }

    return tx;
  });

  // ==========================================
  // TEST 8: Prevent Double Claim
  // ==========================================
  await runTest("Prevent Double Claim", async () => {
    const [betPDA] = getBetPDA(resolvedMarketPDA, bettor1.publicKey);

    // Try to claim again
    try {
      await program.methods
        .claimWinnings()
        .accounts({
          market: resolvedMarketPDA,
          bet: betPDA,
          bettor: bettor1.publicKey,
        } as any)
        .signers([bettor1])
        .rpc();
      throw new Error("Should have thrown AlreadyClaimed error");
    } catch (error: any) {
      const errorCode = error.error?.errorCode?.code || error.errorCode?.code;
      if (errorCode !== "AlreadyClaimed") {
        throw new Error(`Expected AlreadyClaimed, got ${errorCode}`);
      }
      console.log(`   ✅ Correctly prevented double claim`);
    }
    return undefined; // No transaction for error test
  });

  // ==========================================
  // TEST 9: Prevent Unauthorized Resolution
  // ==========================================
  await runTest("Prevent Unauthorized Resolution", async () => {
    const question = `Unauthorized Test ${Date.now()}`;
    const pastEndTime = new BN(Date.now() / 1000 - 3600);
    const questionHash = hashQuestionToArray(question);
    const [marketPDA] = getMarketPDA(creator, question);

    // Create market
    await program.methods
      .initializeMarket(question, pastEndTime, questionHash)
      .accounts({
        market: marketPDA,
        creator: creator,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // Try to resolve with unauthorized account
    try {
      await program.methods
        .resolveMarket(true)
        .accounts({
          market: marketPDA,
          resolutionAuthority: unauthorized.publicKey,
        } as any)
        .signers([unauthorized])
        .rpc();
      throw new Error("Should have thrown UnauthorizedResolution error");
    } catch (error: any) {
      const errorCode = error.error?.errorCode?.code || error.errorCode?.code;
      if (errorCode !== "UnauthorizedResolution") {
        throw new Error(`Expected UnauthorizedResolution, got ${errorCode}`);
      }
      console.log(`   ✅ Correctly prevented unauthorized resolution`);
    }
    return undefined; // No transaction for error test
  });

  // ==========================================
  // TEST 10: Prevent Bet After End Time
  // ==========================================
  await runTest("Prevent Bet After End Time", async () => {
    const question = `Expired Market ${Date.now()}`;
    const pastEndTime = new BN(Date.now() / 1000 - 3600);
    const questionHash = hashQuestionToArray(question);
    const [marketPDA] = getMarketPDA(creator, question);

    // Create market with past end time
    await program.methods
      .initializeMarket(question, pastEndTime, questionHash)
      .accounts({
        market: marketPDA,
        creator: creator,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // Wait a bit to ensure time has passed
    await sleep(2000);

    // Try to place bet
    const [betPDA] = getBetPDA(marketPDA, bettor1.publicKey);
    try {
      await program.methods
        .placeBet(new BN(1 * LAMPORTS_PER_SOL), true)
        .accounts({
          market: marketPDA,
          bet: betPDA,
          bettor: bettor1.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([bettor1])
        .rpc();
      throw new Error("Should have thrown BettingPeriodEnded error");
    } catch (error: any) {
      const errorCode = error.error?.errorCode?.code || error.errorCode?.code;
      if (errorCode !== "BettingPeriodEnded") {
        throw new Error(`Expected BettingPeriodEnded, got ${errorCode}`);
      }
      console.log(`   ✅ Correctly prevented bet after end time`);
    }
    return undefined; // No transaction for error test
  });

  // ==========================================
  // Summary
  // ==========================================
  console.log("\n" + "=".repeat(70));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(70));
  console.log(`Total Tests: ${testCount}`);
  console.log(`✅ Passed: ${passCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`Success Rate: ${((passCount / testCount) * 100).toFixed(1)}%`);
  console.log("\n" + "-".repeat(70));
  console.log("📄 TRANSACTION LINKS (Solscan Devnet)");
  console.log("-".repeat(70));
  
  if (transactionLinks.length === 0) {
    console.log("   No transactions recorded");
  } else {
    transactionLinks.forEach((item, index) => {
      const statusIcon = item.status === "PASSED" ? "✅" : "❌";
      console.log(`\n${index + 1}. ${statusIcon} ${item.test}`);
      console.log(`   Status: ${item.status}`);
      if (item.tx !== "N/A") {
        console.log(`   Transaction: ${item.tx}`);
        console.log(`   🔗 Solscan: ${getSolscanLink(item.tx)}`);
      } else {
        console.log(`   Transaction: N/A (No transaction signature)`);
      }
    });
  }
  
  console.log("\n" + "-".repeat(70));
  console.log("💡 Useful Links:");
  console.log(`   Program Account: https://solscan.io/account/${PROGRAM_ID.toString()}?cluster=devnet`);
  console.log(`   Wallet: https://solscan.io/account/${wallet.publicKey.toString()}?cluster=devnet`);
  console.log("-".repeat(70));
  console.log("=".repeat(70) + "\n");

  if (failCount === 0) {
    console.log("🎉 All tests passed! The smart contract is working correctly on devnet.");
    process.exit(0);
  } else {
    console.log("⚠️  Some tests failed. Please review the errors above.");
    process.exit(1);
  }
}

// Run the tests
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

