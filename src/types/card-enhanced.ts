// Comprehensive card data model for professional collectors

export interface CardIdentification {
  // Core Identification
  playerName: string;
  playerNameVariations?: string[];
  teamName: string;
  teamCity?: string;
  
  // Advanced Set Information
  manufacturer: string;
  brand: string;
  productLine?: string;
  setName: string;
  subset?: string;
  insert?: string;
  
  // Card Details
  cardNumber: string;
  printRun?: number;
  serialNumber?: string;
  variation?: string;
  parallels?: string[];
  
  // Production Details
  printingTechnology?: 'Chrome' | 'Paper' | 'Acetate' | 'Metal' | 'Canvas';
  era?: 'Vintage' | 'Junk Wax' | 'Modern' | 'Ultra-Modern';
}

export interface PlayerMetadata {
  // Player Classification
  isRookie: boolean;
  rookieYear?: number;
  isHallOfFame?: boolean;
  inductionYear?: number;
  jerseyNumber?: string;
  position?: string;
  
  // Career Milestones
  championships?: number;
  allStarAppearances?: number;
  mvpAwards?: number;
  careerHighlights?: string[];
  
  // Card Timing
  isActionShot?: boolean;
  isPortrait?: boolean;
  specialEvent?: string;
  historicalSignificance?: string;
}

export interface AuthenticationData {
  // Primary Grading
  gradingCompany: string;
  gradeNumeric: number;
  gradeLabel?: string;
  certificationNumber: string;
  gradingDate?: Date;
  gradingCost?: number;
  
  // Subgrades (BGS/SGC)
  subgrades?: {
    centering: number;
    corners: number;
    edges: number;
    surface: number;
    autograph?: number;
  };
  
  // Additional Authentication
  authenticator?: string;
  authenticationNumber?: string;
  authenticationType?: 'Letter' | 'Card' | 'Sticker' | 'Witness';
  
  // Population Report
  populationHigher?: number;
  populationEqual?: number;
  populationTotal?: number;
  popReportDate?: Date;
}

export interface SpecialFeatures {
  // Autographs
  hasAutograph: boolean;
  autographType?: 'On-Card' | 'Sticker' | 'Cut';
  autographLocation?: 'Front' | 'Back' | 'Both';
  autographColor?: string;
  autographGrade?: number;
  inscriptions?: string[];
  
  // Memorabilia
  hasMemorabilia: boolean;
  memorabiliaType?: string[];
  memorabiliaColor?: string[];
  isPatch?: boolean;
  patchType?: 'Regular' | 'Logo' | 'Nameplate' | 'Tag' | 'Button';
  isGameUsed?: boolean;
  isPlayerWorn?: boolean;
  
  // Special Attributes
  isRedemption?: boolean;
  redemptionExpiry?: Date;
  isExchangeCard?: boolean;
  is1of1?: boolean;
  isError?: boolean;
  errorType?: string;
  isCorrected?: boolean;
}

export interface MarketData {
  // Purchase Information
  purchaseVenue: 'eBay' | 'COMC' | 'LCS' | 'Show' | 'Retail' | 'Hobby Box' | 'Private Sale' | 'Auction House';
  seller?: string;
  purchaseReference?: string;
  
  // Pricing History
  priceHistory: Array<{
    date: Date;
    price: number;
    source: string;
    condition?: string;
  }>;
  
  // Market Comparables
  lastSaleComps: Array<{
    date: Date;
    price: number;
    grade?: string;
    venue: string;
    serialNumber?: string;
  }>;
  
  // Investment Metrics
  holdingPeriodDays?: number;
  annualizedReturn?: number;
  priceVolatility?: 'Low' | 'Medium' | 'High';
  liquidityScore?: number;
  
  // Market Indicators
  trendDirection?: 'Rising' | 'Stable' | 'Falling';
  demandLevel?: 'Hot' | 'Warm' | 'Cold';
  populationRarity?: 'Common' | 'Scarce' | 'Rare' | 'Ultra-Rare';
}

export interface PhysicalAttributes {
  // Size & Format
  cardSize?: 'Standard' | 'Tobacco' | 'Oversized' | 'Mini' | 'Booklet';
  dimensions?: {
    width: number;
    height: number;
    thickness?: number;
  };
  
  // Physical Features
  isGlossy?: boolean;
  isRefractor?: boolean;
  hasUVCoating?: boolean;
  stockWeight?: 'Standard' | 'Thick' | 'Super Thick';
  
  // Condition Details
  conditionNotes?: {
    centering?: string;
    cornerWear?: string[];
    edgeWear?: string[];
    surfaceIssues?: string[];
    creases?: string[];
    staining?: string[];
  };
  
  // Alterations/Restoration
  isAltered?: boolean;
  alterationType?: string[];
  hasBeenCleaned?: boolean;
}

export interface StorageData {
  // Physical Location
  storageLocation: string;
  storageMethod: 'Raw' | 'Penny Sleeve' | 'Toploader' | 'One-Touch' | 'Magnetic Card Holder' | 'Screw Down' | 'Binder' | 'Graded Slab';
  sleeveType?: 'Standard' | 'Premium' | 'Team Bag';
  
  // Organization
  collectionCategory: 'PC' | 'Investment' | 'Trade Bait' | 'Duplicate' | 'Consignment';
  displayStatus?: 'Displayed' | 'Stored' | 'Loaned' | 'At Grader';
  
  // Tracking
  inventoryCode?: string;
  boxNumber?: string;
  binderPage?: number;
  position?: string;
  
  // Protection
  hasUVProtection?: boolean;
  humidity?: number;
  temperature?: number;
  lastInspectionDate?: Date;
}

export interface TransactionData {
  // Provenance
  previousOwners?: string[];
  certificateOfAuthenticity?: boolean;
  coaNumber?: string;
  provenanceDocumentation?: string[];
  
  // Insurance & Legal
  insuredValue: number;
  insuranceCompany?: string;
  policyNumber?: string;
  appraisalValue?: number;
  appraisalDate?: Date;
  appraiser?: string;
  
  // Consignment
  consignmentStatus?: 'Available' | 'Listed' | 'Under Offer' | 'Sold';
  consignmentVenue?: string;
  consignmentFee?: number;
  minimumPrice?: number;
  
  // Tax & Accounting
  taxBasis?: number;
  acquisitionType?: 'Purchase' | 'Gift' | 'Inheritance' | 'Trade';
  fairMarketValueAtAcquisition?: number;
  capitalGainsEligible?: boolean;
}

export interface DigitalFeatures {
  // Images & Scans
  images: {
    front: string;
    back: string;
    angles?: string[];
    authentication?: string[];
    flaws?: string[];
  };
  
  // Digital Presence
  showcaseUrl?: string;
  forumThreads?: string[];
  youtubeVideos?: string[];
  
  // Social Features
  instagramHandle?: string;
  tradingGroups?: string[];
  wishlistPriority?: number;
  
  // NFT/Blockchain (if applicable)
  hasDigitalTwin?: boolean;
  nftContract?: string;
  tokenId?: string;
  blockchain?: string;
}

export interface CardAnalytics {
  // Performance Metrics
  totalReturn: number;
  percentageReturn: number;
  monthlyAppreciation?: number;
  
  // Comparative Analysis
  performanceVsSet?: number;
  performanceVsPlayer?: number;
  performanceVsMarket?: number;
  
  // Risk Metrics
  priceVolatility30d?: number;
  priceVolatility90d?: number;
  liquidityRank?: number;
  
  // Predictive Indicators
  growthPotential?: 'Low' | 'Medium' | 'High';
  sellRecommendation?: 'Hold' | 'Sell' | 'Strong Sell';
  targetPrice?: number;
  priceConfidence?: number;
}

export interface CollectionMetadata {
  // Grouping
  collectionSets?: string[];
  masterSetProgress?: number;
  rainbowProgress?: Array<{
    parallel: string;
    owned: boolean;
    serialNumber?: string;
  }>;
  
  // Goals & Tracking
  acquisitionGoals?: string[];
  targetSellDate?: Date;
  targetSellPrice?: number;
  
  // Personal Rating
  personalGrade?: number;
  sentimentalValue?: 'Low' | 'Medium' | 'High';
  willingToTrade?: boolean;
  tradeValue?: number;
  
  // Notes & History
  personalStory?: string;
  acquisitionStory?: string;
  specialMeaning?: string;
}

// Main enhanced card interface combining all features
export interface EnhancedCard {
  // Core fields (keeping compatibility)
  id: string;
  userId?: string;
  collectionId?: string;
  collectionType?: 'PC' | 'Inventory' | 'Pending';
  createdAt: Date;
  updatedAt: Date;
  
  // Basic Information (legacy support)
  player: string;
  team: string;
  year: number;
  brand: string;
  category: string;
  cardNumber: string;
  parallel?: string;
  condition: string;
  gradingCompany?: string;
  
  // Financial (legacy support)
  purchasePrice: number;
  purchaseDate: Date;
  sellPrice?: number;
  sellDate?: Date;
  currentValue: number;
  
  // Images & Notes
  images: string[];
  notes: string;
  
  // New Enhanced Fields
  identification?: CardIdentification;
  playerMetadata?: PlayerMetadata;
  authentication?: AuthenticationData;
  specialFeatures?: SpecialFeatures;
  marketData?: MarketData;
  physicalAttributes?: PhysicalAttributes;
  storage?: StorageData;
  transaction?: TransactionData;
  digital?: DigitalFeatures;
  analytics?: CardAnalytics;
  collectionMeta?: CollectionMetadata;
}

// Helper type for form creation
export type EnhancedCardFormData = Partial<EnhancedCard>;

// Constants for dropdowns
export const PRINTING_TECHNOLOGIES = ['Chrome', 'Paper', 'Acetate', 'Metal', 'Canvas'] as const;
export const CARD_ERAS = ['Vintage', 'Junk Wax', 'Modern', 'Ultra-Modern'] as const;
export const PURCHASE_VENUES = ['eBay', 'COMC', 'LCS', 'Show', 'Retail', 'Hobby Box', 'Private Sale', 'Auction House'] as const;
export const STORAGE_METHODS = ['Raw', 'Penny Sleeve', 'Toploader', 'One-Touch', 'Magnetic Card Holder', 'Screw Down', 'Binder', 'Graded Slab'] as const;
export const COLLECTION_CATEGORIES = ['PC', 'Investment', 'Trade Bait', 'Duplicate', 'Consignment'] as const;

// Validation helper
export const isEnhancedCard = (card: any): card is EnhancedCard => {
  return card && typeof card.id === 'string' && typeof card.player === 'string';
};