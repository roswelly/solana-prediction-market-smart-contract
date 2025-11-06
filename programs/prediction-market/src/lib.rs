use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

declare_id!("3LHuBziG2Tp1UrxgoTAZDDbvDK46quk6T99kHkgt8UQg");

#[program]
pub mod prediction_market {
    use super::*;

 
    /// Creates a PDA account to store market state
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        question: String,
        end_time: i64,
        question_hash: [u8; 32], 
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let clock = Clock::get()?;

        require!(end_time > clock.unix_timestamp, ErrorCode::InvalidEndTime);

        let computed_hash = hash(question.as_bytes());
        require!(
            computed_hash.to_bytes() == question_hash,
            ErrorCode::MathOverflow 
        );

        market.creator = ctx.accounts.creator.key();
        market.resolution_authority = ctx.accounts.creator.key(); 
        market.question = question;
        market.end_time = end_time;
        market.resolved = false;
        market.outcome = None;
        market.total_yes_bets = 0;
        market.total_no_bets = 0;
        market.fee_percentage = 100; 
        market.bump = ctx.bumps.market;

        msg!("Market initialized: {}", market.question);
        Ok(())
    }

    
    /// Transfers SOL from user to market PDA
    pub fn place_bet(ctx: Context<PlaceBet>, amount: u64, outcome: bool) -> Result<()> {
        let clock = Clock::get()?;
        let market_key = ctx.accounts.market.key();
        let bettor_key = ctx.accounts.bettor.key();


        require!(!ctx.accounts.market.resolved, ErrorCode::MarketAlreadyResolved);

        require!(
            clock.unix_timestamp < ctx.accounts.market.end_time,
            ErrorCode::BettingPeriodEnded
        );

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

        // Initialize bet account 
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

    pub fn resolve_market(ctx: Context<ResolveMarket>, outcome: bool) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let clock = Clock::get()?;

        require!(!market.resolved, ErrorCode::MarketAlreadyResolved);

        require!(
            clock.unix_timestamp >= market.end_time,
            ErrorCode::BettingPeriodNotEnded
        );

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

    /// Calculates share of total pool minus fee
    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market = &ctx.accounts.market;
        let bet = &mut ctx.accounts.bet;

        require!(market.resolved, ErrorCode::MarketNotResolved);

        require!(market.outcome.is_some(), ErrorCode::MarketNotResolved);

        require!(
            bet.outcome == market.outcome.unwrap(),
            ErrorCode::NotAWinner
        );

        require!(!bet.claimed, ErrorCode::AlreadyClaimed);

        let total_pool = market
            .total_yes_bets
            .checked_add(market.total_no_bets)
            .ok_or(ErrorCode::MathOverflow)?;

        let winning_pool = if market.outcome.unwrap() {
            market.total_yes_bets
        } else {
            market.total_no_bets
        };

        require!(winning_pool > 0, ErrorCode::MathOverflow);

        let fee_amount = total_pool
            .checked_mul(market.fee_percentage as u64)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::MathOverflow)?;

        // Calculate pool after fee
        let pool_after_fee = total_pool
            .checked_sub(fee_amount)
            .ok_or(ErrorCode::MathOverflow)?;

        let winnings = bet
            .amount
            .checked_mul(pool_after_fee)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(winning_pool)
            .ok_or(ErrorCode::MathOverflow)?;

        **ctx.accounts.market.to_account_info().try_borrow_mut_lamports()? -= winnings;
        **ctx.accounts.bettor.to_account_info().try_borrow_mut_lamports()? += winnings;

        bet.claimed = true;

        msg!("Winnings claimed: {} SOL", winnings);

        Ok(())
    }
}


#[account]
pub struct Market {
    pub creator: Pubkey,           
    pub resolution_authority: Pubkey,
    pub question: String,           
    pub end_time: i64,              
    pub resolved: bool,             
    pub outcome: Option<bool>,     
    pub total_yes_bets: u64,        
    pub total_no_bets: u64,         
    pub fee_percentage: u16,       
    pub bump: u8,                   
}

impl Market {
    pub const MAX_QUESTION_LENGTH: usize = 200;
    pub const DISCRIMINATOR_LENGTH: usize = 8;
    
    pub fn space() -> usize {
        Self::DISCRIMINATOR_LENGTH
        + 32  
        + 32  
        + 4 + Self::MAX_QUESTION_LENGTH  
        + 8  
        + 1   
        + 2   
        + 8   
        + 8   
        + 2   
        + 1   
    }
}

#[account]
pub struct Bet {
    pub bettor: Pubkey,  
    pub market: Pubkey,  
    pub amount: u64,     
    pub outcome: bool,  
    pub claimed: bool,   
    pub bump: u8,       
}

impl Bet {
    pub const DISCRIMINATOR_LENGTH: usize = 8;
    
    pub fn space() -> usize {
        Self::DISCRIMINATOR_LENGTH
        + 32  
        + 32  
        + 8  
        + 1
        + 1
        + 1    }
}


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
    
    #[account(mut)]
    pub bettor: Signer<'info>,
}


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
