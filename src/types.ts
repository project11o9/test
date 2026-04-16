export interface User {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  wallet_balance: number;
  credit_score: number;
  kyc_status: 'Verified' | 'Pending' | 'Rejected';
  bank_details?: {
    account_number: string;
    ifsc: string;
    bank_name: string;
  };
  upi_id?: string;
  status: 'Active' | 'Blocked';
  is_active?: boolean;
  role: 'admin' | 'user';
  createdAt?: string;
}

export interface Stock {
  id: string;
  symbol: string;
  name: string;
  price: number;
  order: number;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success';
  target_uids: string[]; // ['all'] for everyone
  timestamp: string;
}

export interface FeatureFlags {
  review_system: boolean;
  wallet_access: boolean;
  withdrawal_option: boolean;
  spin_feature: boolean;
  credit_score_panel: boolean;
  profile_editing: boolean;
}

export interface SpinSettings {
  enabled: boolean;
  rewards: {
    value: number;
    probability: number; // 0-1
    label: string;
  }[];
}

export interface InjectionRule {
  id: string;
  stockId: string;
  position: number;
  target_uid?: string; // Optional: specific user
  active: boolean;
}

export interface DepositRequest {
  id: string;
  user_uid: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

export interface WithdrawRequest {
  id: string;
  user_uid: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  admin_uid: string;
  target_uid?: string;
  timestamp: string;
  [key: string]: any;
}
