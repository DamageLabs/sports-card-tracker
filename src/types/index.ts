export interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  profilePhoto?: string | null;
}

export interface StorageLocation {
  room?: string;
  shelf?: string;
  box?: string;
  row?: string;
  slot?: string;
  method?: string;
  notes?: string;
}

export type CollectionType = 'PC' | 'Inventory' | 'Pending';

export const COLLECTION_TYPES: { value: CollectionType; label: string }[] = [
  { value: 'Inventory', label: 'Inventory (For Sale)' },
  { value: 'PC', label: 'Personal Collection (Keep)' },
  { value: 'Pending', label: 'Pending (Unsorted)' }
];

export interface Card {
  id: string;
  userId: string; // User who owns this card
  collectionId?: string; // Collection this card belongs to
  collectionType: CollectionType; // PC = never sell, Inventory = for sale
  player: string;
  team: string;
  year: number;
  brand: string;
  category: string;
  cardNumber: string;
  parallel?: string;
  condition: string;
  gradingCompany?: string;
  setName?: string;
  serialNumber?: string;
  grade?: string;
  isRookie?: boolean;
  isAutograph?: boolean;
  isRelic?: boolean;
  isNumbered?: boolean;
  isGraded?: boolean;
  purchasePrice: number;
  purchaseDate: Date;
  sellPrice?: number;
  sellDate?: Date;
  currentValue: number;
  storageLocation?: StorageLocation | null;
  enhancedAttributes?: Record<string, unknown> | null;
  images: string[];
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CardFormData {
  player: string;
  team: string;
  year: number;
  brand: string;
  category: string;
  cardNumber: string;
  parallel?: string;
  condition: string;
  gradingCompany?: string;
  purchasePrice: number;
  purchaseDate: string;
  sellPrice?: number;
  sellDate?: string;
  currentValue: number;
  notes: string;
  collectionId?: string;
  collectionType?: string;
}

export interface PortfolioStats {
  totalCards: number;
  totalCostBasis: number;
  totalCurrentValue: number;
  totalProfit: number;
  totalSold: number;
  totalSoldValue: number;
}

export interface FilterOptions {
  player?: string;
  team?: string;
  year?: number;
  brand?: string;
  category?: string;
  condition?: string;
  minValue?: number;
  maxValue?: number;
  collectionType?: string;
  soldStatus?: 'sold' | 'unsold';
}

export interface SortOption {
  field: keyof Card;
  direction: 'asc' | 'desc';
}

export type ConditionGrade =
  | 'RAW'
  | '10: GEM MINT'
  | '9.5: MINT+'
  | '9: MINT'
  | '8.5: NEAR MINT-MINT+'
  | '8: NEAR MINT-MINT'
  | '7.5: NEAR MINT+'
  | '7: NEAR MINT'
  | '6.5: EXCELLENT-MINT+'
  | '6: EXCELLENT-MINT'
  | '5.5: EXCELLENT+'
  | '5: EXCELLENT'
  | '4.5: VERY GOOD-EXCELLENT+'
  | '4: VERY GOOD-EXCELLENT'
  | '3.5: VERY GOOD+'
  | '3: VERY GOOD'
  | '2.5: GOOD+'
  | '2: GOOD'
  | '1.5: POOR+'
  | '1: POOR';

export const CONDITIONS: ConditionGrade[] = [
  'RAW',
  '10: GEM MINT',
  '9.5: MINT+',
  '9: MINT',
  '8.5: NEAR MINT-MINT+',
  '8: NEAR MINT-MINT',
  '7.5: NEAR MINT+',
  '7: NEAR MINT',
  '6.5: EXCELLENT-MINT+',
  '6: EXCELLENT-MINT',
  '5.5: EXCELLENT+',
  '5: EXCELLENT',
  '4.5: VERY GOOD-EXCELLENT+',
  '4: VERY GOOD-EXCELLENT',
  '3.5: VERY GOOD+',
  '3: VERY GOOD',
  '2.5: GOOD+',
  '2: GOOD',
  '1.5: POOR+',
  '1: POOR'
];

export type CardCategory = 
  | 'Racing'
  | 'MMA'
  | 'Wrestling'
  | 'Pokemon'
  | 'Soccer'
  | 'Hockey'
  | 'Baseball'
  | 'Basketball'
  | 'Football'
  | 'Magic: The Gathering';

export const CATEGORIES: CardCategory[] = [
  'Racing',
  'MMA',
  'Wrestling',
  'Pokemon',
  'Soccer',
  'Hockey',
  'Baseball',
  'Basketball',
  'Football',
  'Magic: The Gathering'
];

export type GradingCompany = 
  | 'PSA'
  | 'BGS'
  | 'SGC'
  | 'CGC Cards'
  | 'CSG'
  | 'HGA'
  | 'TAG'
  | 'ISA'
  | 'GMA Grading'
  | 'ACE Grading';

export const GRADING_COMPANIES: GradingCompany[] = [
  'PSA',
  'BGS',
  'SGC',
  'CGC Cards',
  'CSG',
  'HGA',
  'TAG',
  'ISA',
  'GMA Grading',
  'ACE Grading'
];

export interface GradeOption {
  value: string;
  label: string;
}

export const GRADING_SCALES: Record<string, GradeOption[]> = {
  PSA: [
    { value: '10', label: '10 - GEM-MT' },
    { value: '9', label: '9 - MINT' },
    { value: '8', label: '8 - NM-MT' },
    { value: '7', label: '7 - NM' },
    { value: '6', label: '6 - EX-MT' },
    { value: '5', label: '5 - EX' },
    { value: '4', label: '4 - VG-EX' },
    { value: '3', label: '3 - VG' },
    { value: '2', label: '2 - GOOD' },
    { value: '1.5', label: '1.5 - FR' },
    { value: '1', label: '1 - PR' },
    { value: 'A', label: 'A - Authentic' },
  ],
  BGS: [
    { value: '10', label: '10 - Pristine' },
    { value: '9.5', label: '9.5 - Gem Mint' },
    { value: '9', label: '9 - Mint' },
    { value: '8.5', label: '8.5 - NM-MT+' },
    { value: '8', label: '8 - NM-MT' },
    { value: '7.5', label: '7.5 - NM+' },
    { value: '7', label: '7 - NM' },
    { value: '6.5', label: '6.5 - EX-MT+' },
    { value: '6', label: '6 - EX-MT' },
    { value: '5.5', label: '5.5 - EX+' },
    { value: '5', label: '5 - EX' },
    { value: '4.5', label: '4.5 - VG-EX+' },
    { value: '4', label: '4 - VG-EX' },
    { value: '3.5', label: '3.5 - VG+' },
    { value: '3', label: '3 - VG' },
    { value: '2.5', label: '2.5 - G+' },
    { value: '2', label: '2 - G' },
    { value: '1.5', label: '1.5 - FR' },
    { value: '1', label: '1 - PR' },
  ],
  SGC: [
    { value: '10', label: '10 - GEM MINT' },
    { value: '9.5', label: '9.5 - MINT+' },
    { value: '9', label: '9 - MINT' },
    { value: '8.5', label: '8.5 - NM-MT+' },
    { value: '8', label: '8 - NM-MT' },
    { value: '7.5', label: '7.5 - NM+' },
    { value: '7', label: '7 - NM' },
    { value: '6.5', label: '6.5 - EX-NM+' },
    { value: '6', label: '6 - EX-NM' },
    { value: '5.5', label: '5.5 - EX+' },
    { value: '5', label: '5 - EX' },
    { value: '4.5', label: '4.5 - VG-EX+' },
    { value: '4', label: '4 - VG-EX' },
    { value: '3.5', label: '3.5 - VG+' },
    { value: '3', label: '3 - VG' },
    { value: '2.5', label: '2.5 - GOOD+' },
    { value: '2', label: '2 - GOOD' },
    { value: '1.5', label: '1.5 - FR' },
    { value: '1', label: '1 - PR' },
    { value: 'A', label: 'A - Authentic' },
  ],
  'CGC Cards': [
    { value: '10', label: '10 - Pristine' },
    { value: '9.5', label: '9.5 - Gem Mint' },
    { value: '9', label: '9 - Mint' },
    { value: '8.5', label: '8.5 - NM/Mint+' },
    { value: '8', label: '8 - NM/Mint' },
    { value: '7.5', label: '7.5 - NM+' },
    { value: '7', label: '7 - NM' },
    { value: '6.5', label: '6.5 - EX/NM+' },
    { value: '6', label: '6 - EX/NM' },
    { value: '5.5', label: '5.5 - EX+' },
    { value: '5', label: '5 - EX' },
    { value: '4.5', label: '4.5 - VG/EX+' },
    { value: '4', label: '4 - VG/EX' },
    { value: '3.5', label: '3.5 - VG+' },
    { value: '3', label: '3 - VG' },
    { value: '2.5', label: '2.5 - G+' },
    { value: '2', label: '2 - G' },
    { value: '1.5', label: '1.5 - FR' },
    { value: '1', label: '1 - PR' },
  ],
};

export const GENERIC_GRADE_SCALE: GradeOption[] = [
  { value: '10', label: '10' },
  { value: '9.5', label: '9.5' },
  { value: '9', label: '9' },
  { value: '8.5', label: '8.5' },
  { value: '8', label: '8' },
  { value: '7.5', label: '7.5' },
  { value: '7', label: '7' },
  { value: '6.5', label: '6.5' },
  { value: '6', label: '6' },
  { value: '5.5', label: '5.5' },
  { value: '5', label: '5' },
  { value: '4.5', label: '4.5' },
  { value: '4', label: '4' },
  { value: '3.5', label: '3.5' },
  { value: '3', label: '3' },
  { value: '2.5', label: '2.5' },
  { value: '2', label: '2' },
  { value: '1.5', label: '1.5' },
  { value: '1', label: '1' },
];

export const getGradeScale = (company: string): GradeOption[] => {
  return GRADING_SCALES[company] || GENERIC_GRADE_SCALE;
};

export const RAW_CONDITIONS = ['Raw', 'Near Mint', 'Excellent', 'Very Good', 'Good', 'Poor'];

export type PriceAlertType = 'above' | 'below';

export interface PriceAlert {
  id: string;
  cardId: string;
  userId: string;
  type: PriceAlertType;
  thresholdLow: number | null;
  thresholdHigh: number | null;
  isEnabled: boolean;
  lastCheckedAt: string | null;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PriceAlertHistoryEntry {
  id: string;
  alertId: string;
  cardId: string;
  previousValue: number;
  currentValue: number;
  threshold: number;
  type: PriceAlertType;
  createdAt: string;
  player?: string;
}