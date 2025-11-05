use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

declare_id!("3LHuBziG2Tp1UrxgoTAZDDbvDK46quk6T99kHkgt8UQg");

#[program]
pub mod prediction_market {
    use super::*;

    /// Initialize a new prediction market
    /// Creates a PDA account to store market state
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        question: String,
        end_time: i64,
        question_hash: [u8; 32], // SHA256 hash of question for PDA seeds
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let clock = Clock::get()?;

        // Validate end time is in the future
        require!(end_time > clock.unix_timestamp, ErrorCode::InvalidEndTime);

        // Validate that the hash matches the question
        let computed_hash = hash(question.as_bytes());
        require!(
            computed_hash.to_bytes() == question_hash,
            ErrorCode::MathOverflow // Reuse error code for now
        );

        market.creator = ctx.accounts.creator.key();
        market.resolution_authority = ctx.accounts.creator.key(); // Default to creator
        market.question = question;
        market.end_time = end_time;
        market.resolved = false;
        market.outcome = None;
        market.total_yes_bets = 0;
        market.total_no_bets = 0;
        market.fee_percentage = 100; // 1% (stored as basis points, 100 = 1%)
        market.bump = ctx.bumps.market;

        msg!("Market initialized: {}", market.question);
        Ok(())
    }

    /// Place a bet on Yes or No outcome
    /// Transfers SOL from user to market PDA
    pub fn place_bet(ctx: Context<PlaceBet>, amount: u64, outcome: bool) -> Result<()> {
        let clock = Clock::get()?;
        let market_key = ctx.accounts.market.key();
        let bettor_key = ctx.accounts.bettor.key();

        // Validate market is not resolved
        require!(!ctx.accounts.market.resolved, ErrorCode::MarketAlreadyResolved);

        // Validate betting period hasn't ended
        require!(
            clock.unix_timestamp < ctx.accounts.market.end_time,
            ErrorCode::BettingPeriodEnded
        );

        // Feature: Prevent placing bets with zero amount
        // This ensures users cannot place bets with 0 SOL
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Transfer SOL from user to market PDA
        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::system_instruction::transfer(
                &bettor_key,
                &market_key,
                amount,
            ),
            &[
                ctx.accounts.bettor.to_account_info(),
                ctx.accounts.market.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Update market totals
        let market = &mut ctx.accounts.market;
        if outcome {
            // Betting on Yes
            market.total_yes_bets = market
                .total_yes_bets
                .checked_add(amount)
                .ok_or(ErrorCode::MathOverflow)?;
        } else {
            // Betting on No
            market.total_no_bets = market
                .total_no_bets
                .checked_add(amount)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        // Initialize bet account (this is a new bet)
        let bet = &mut ctx.accounts.bet;
        bet.bettor = ctx.accounts.bettor.key();
        bet.market = ctx.accounts.market.key();
        bet.amount = amount;
        bet.outcome = outcome;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        msg!(
            "Bet placed: {} SOL on {}",
            amount,
            if outcome { "Yes" } else { "No" }
        );

        Ok(())
    }

    /// Resolve the market with the true outcome
    /// Can only be called by resolution authority after end time
    pub fn resolve_market(ctx: Context<ResolveMarket>, outcome: bool) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let clock = Clock::get()?;

        // Validate market is not already resolved
        require!(!market.resolved, ErrorCode::MarketAlreadyResolved);

        // Validate betting period has ended
        require!(
            clock.unix_timestamp >= market.end_time,
            ErrorCode::BettingPeriodNotEnded
        );

        // Validate caller is resolution authority
        require!(
            ctx.accounts.resolution_authority.key() == market.resolution_authority,
            ErrorCode::UnauthorizedResolution
        );

        market.resolved = true;
        market.outcome = Some(outcome);

        msg!(
            "Market resolved: {}",
            if outcome { "Yes" } else { "No" }
        );

        Ok(())
    }

    /// Claim winnings for a winning bet
    /// Calculates proportional share of total pool minus fee
    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market = &ctx.accounts.market;
        let bet = &mut ctx.accounts.bet;

        // Validate market is resolved - this prevents claiming before resolution
        require!(market.resolved, ErrorCode::MarketNotResolved);

        // Validate bet has outcome set
        require!(market.outcome.is_some(), ErrorCode::MarketNotResolved);

        // Validate bettor is a winner
        require!(
            bet.outcome == market.outcome.unwrap(),
            ErrorCode::NotAWinner
        );

        // Validate winnings haven't been claimed
        require!(!bet.claimed, ErrorCode::AlreadyClaimed);

        // Calculate total pool
        let total_pool = market
            .total_yes_bets
            .checked_add(market.total_no_bets)
            .ok_or(ErrorCode::MathOverflow)?;

        // Determine winning pool
        let winning_pool = if market.outcome.unwrap() {
            market.total_yes_bets
        } else {
            market.total_no_bets
        };

        // Validate winning pool is not zero (shouldn't happen, but safety check)
        require!(winning_pool > 0, ErrorCode::MathOverflow);

        // Calculate total fee amount (1% of total pool)
        let fee_amount = total_pool
            .checked_mul(market.fee_percentage as u64)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;

        // Calculate pool after fee
        let pool_after_fee = total_pool
            .checked_sub(fee_amount)
            .ok_or(ErrorCode::MathOverflow)?;

        // Calculate bettor's proportional share of winnings
        // Formula: (bet_amount / winning_pool) * pool_after_fee
        let winnings = bet
            .amount
            .checked_mul(pool_after_fee)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(winning_pool)
            .ok_or(ErrorCode::MathOverflow)?;

        // Transfer winnings to bettor
        **ctx.accounts.market.to_account_info().try_borrow_mut_lamports()? -= winnings;
        **ctx.accounts.bettor.to_account_info().try_borrow_mut_lamports()? += winnings;

        // Mark bet as claimed
        bet.claimed = true;

        msg!("Winnings claimed: {} SOL", winnings);

        Ok(())
    }
}

// Account Structures

/// Market account - stores market state
#[account]
pub struct Market {
    pub creator: Pubkey,           // Creator of the market
    pub resolution_authority: Pubkey, // Authority that can resolve the market
    pub question: String,           // The prediction question
    pub end_time: i64,              // Unix timestamp when betting ends
    pub resolved: bool,             // Whether market has been resolved
    pub outcome: Option<bool>,      // True = Yes, False = No
    pub total_yes_bets: u64,        // Total SOL bet on Yes
    pub total_no_bets: u64,         // Total SOL bet on No
    pub fee_percentage: u16,        // Fee percentage in basis points (100 = 1%)
    pub bump: u8,                   // PDA bump seed
}

impl Market {
    pub const MAX_QUESTION_LENGTH: usize = 200;
    pub const DISCRIMINATOR_LENGTH: usize = 8;
    
    pub fn space() -> usize {
        Self::DISCRIMINATOR_LENGTH
        + 32  // creator
        + 32  // resolution_authority
        + 4 + Self::MAX_QUESTION_LENGTH  // question (String with length prefix)
        + 8   // end_time
        + 1   // resolved
        + 2   // outcome (Option<bool>)
        + 8   // total_yes_bets
        + 8   // total_no_bets
        + 2   // fee_percentage
        + 1   // bump
    }
}

/// Bet account - stores individual bet information
#[account]
pub struct Bet {
    pub bettor: Pubkey,  // The user who placed the bet
    pub market: Pubkey,  // The market this bet belongs to
    pub amount: u64,     // Total amount bet
    pub outcome: bool,   // True = Yes, False = No
    pub claimed: bool,   // Whether winnings have been claimed
    pub bump: u8,        // PDA bump seed
}

impl Bet {
    pub const DISCRIMINATOR_LENGTH: usize = 8;
    
    pub fn space() -> usize {
        Self::DISCRIMINATOR_LENGTH
        + 32  // bettor
        + 32  // market
        + 8   // amount
        + 1   // outcome
        + 1   // claimed
        + 1   // bump
    }
}

// Context Structures

#[derive(Accounts)]
#[instruction(question: String, end_time: i64, question_hash: [u8; 32])]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = creator,
        space = Market::space(),
        seeds = [b"market", creator.key().as_ref(), &question_hash[..]],
        bump
    )]
    pub market: Account<'info, Market>,
    
    #[account(mut)]
    pub creator: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    #[account(
        init,
        payer = bettor,
        space = Bet::space(),
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    
    #[account(mut)]
    pub bettor: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    pub resolution_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    
    #[account(
        mut,
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump = bet.bump,
        constraint = bet.bettor == bettor.key() @ ErrorCode::InvalidBettor,
        constraint = bet.market == market.key() @ ErrorCode::InvalidBettor
    )]
    pub bet: Account<'info, Bet>,
    
    /// CHECK: We manually verify the bettor matches
    #[account(mut)]
    pub bettor: Signer<'info>,
}

// Error Codes

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid end time - must be in the future")]
    InvalidEndTime,
    
    #[msg("Market has already been resolved")]
    MarketAlreadyResolved,
    
    #[msg("Betting period has ended")]
    BettingPeriodEnded,
    
    #[msg("Betting period has not ended yet")]
    BettingPeriodNotEnded,
    
    #[msg("Invalid bet amount")]
    InvalidAmount,
    
    #[msg("Unauthorized to resolve market")]
    UnauthorizedResolution,
    
    #[msg("Market has not been resolved yet")]
    MarketNotResolved,
    
    #[msg("Bettor is not a winner")]
    NotAWinner,
    
    #[msg("Winnings have already been claimed")]
    AlreadyClaimed,
    
    #[msg("Math overflow")]
    MathOverflow,
    
    #[msg("Invalid bettor")]
    InvalidBettor,
}
