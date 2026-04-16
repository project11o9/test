/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  ArrowDownCircle, 
  ArrowUpCircle, 
  LogOut, 
  Search, 
  Wallet, 
  ShieldAlert, 
  TrendingUp, 
  CheckCircle2, 
  XCircle,
  Menu,
  X,
  LayoutDashboard,
  Settings,
  Bell,
  Star,
  RefreshCw,
  Trash2,
  Lock,
  Unlock,
  Eye,
  Plus,
  Save,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  onSnapshot, 
  updateDoc, 
  addDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy,
  limit,
  getDoc,
  setDoc,
  getDocs,
  Timestamp
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { 
  User, 
  Stock, 
  Notification, 
  FeatureFlags, 
  SpinSettings, 
  InjectionRule,
  DepositRequest,
  WithdrawRequest,
  AuditLog
} from './types';

// Error Handling Helper
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Components
function NavItem({ icon, label, active, collapsed, onClick }: { 
  icon: React.ReactNode; 
  label: string; 
  active: boolean; 
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <div 
      className={`
        flex items-center gap-3 px-6 py-3 cursor-pointer transition-all border-l-4
        ${active 
          ? 'bg-white/5 text-white border-[#10B981]' 
          : 'text-slate-400 border-transparent hover:bg-white/5 hover:text-white hover:border-[#10B981]/50'
        }
      `}
      onClick={onClick}
    >
      <div className={`${active ? 'text-[#10B981]' : 'text-slate-500'} transition-colors`}>
        {icon}
      </div>
      {!collapsed && <span className="text-sm font-medium whitespace-nowrap">{label}</span>}
    </div>
  );
}

function Modal({ isOpen, onClose, title, children, size = 'md' }: { 
  isOpen: boolean; 
  onClose: () => void; 
  title: string; 
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
    full: 'max-w-4xl'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={`bg-white rounded-2xl shadow-2xl w-full ${sizeClasses[size]} relative z-10 overflow-hidden flex flex-col max-h-[90vh]`}
      >
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-lg transition-colors text-slate-400">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '', name: '' });
  const [activePage, setActivePage] = useState<'dashboard' | 'users' | 'stocks' | 'notifications' | 'settings' | 'audit'>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Data State
  const [users, setUsers] = useState<User[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);
  const [spinSettings, setSpinSettings] = useState<SpinSettings | null>(null);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdraws, setWithdraws] = useState<WithdrawRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<Partial<Stock> | null>(null);
  const [auditActionFilter, setAuditActionFilter] = useState('');

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // Data Listeners
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const unsubUsers = onSnapshot(query(collection(db, 'users'), limit(200)), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as User)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'users'));

    const unsubStocks = onSnapshot(query(collection(db, 'stocks'), limit(200)), (snapshot) => {
      setStocks(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Stock)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'stocks'));

    const unsubNotifications = onSnapshot(query(collection(db, 'notifications'), orderBy('timestamp', 'desc'), limit(200)), (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Notification)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'notifications'));

    const unsubFeatures = onSnapshot(doc(db, 'settings', 'features'), (doc) => {
      if (doc.exists()) setFeatureFlags(doc.data() as FeatureFlags);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'settings/features'));

    const unsubSpin = onSnapshot(doc(db, 'settings', 'spin'), (doc) => {
      if (doc.exists()) setSpinSettings(doc.data() as SpinSettings);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'settings/spin'));

    const unsubDeposits = onSnapshot(query(collection(db, 'deposits'), where('status', '==', 'pending'), limit(200)), (snapshot) => {
      setDeposits(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as DepositRequest)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'deposits'));

    const unsubWithdraws = onSnapshot(query(collection(db, 'withdraws'), where('status', '==', 'pending'), limit(200)), (snapshot) => {
      setWithdraws(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as WithdrawRequest)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'withdraws'));

    const unsubAuditLogs = onSnapshot(query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(200)), (snapshot) => {
      setAuditLogs(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as AuditLog)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'audit_logs'));

    return () => {
      unsubUsers();
      unsubStocks();
      unsubNotifications();
      unsubFeatures();
      unsubSpin();
      unsubDeposits();
      unsubWithdraws();
      unsubAuditLogs();
    };
  }, [user, isAuthReady]);

  // Handlers
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, loginForm.email, loginForm.password);
        const newUser: User = {
          uid: userCredential.user.uid,
          name: loginForm.name,
          email: loginForm.email,
          wallet_balance: 0,
          credit_score: 50,
          kyc_status: 'Pending',
          status: 'Active',
          role: (loginForm.email === 'veerthakurma2002@gmail.com' || loginForm.email === 'adminhoon@fedility.com') ? 'admin' : 'user',
          createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'users', userCredential.user.uid), newUser);
        alert("Registration successful!");
      } else {
        await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
      }
    } catch (err) {
      alert("Authentication failed: " + (err as Error).message);
    }
  };

  const handleLogout = () => signOut(auth);

  const toggleUserActive = async (uid: string, currentStatus: boolean) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/users/${uid}/toggle-active`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ is_active: !currentStatus })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert("Failed to toggle status: " + (err as Error).message);
    }
  };

  const resetUserPassword = async (uid: string) => {
    const newPassword = prompt("Enter new password for this user:");
    if (!newPassword) return;
    
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/users/${uid}/reset-password`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert("Failed to reset password: " + (err as Error).message);
    }
  };

  const updateUser = async (uid: string, data: Partial<User>) => {
    try {
      await updateDoc(doc(db, 'users', uid), data);
      alert("User updated successfully");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const deleteUser = async (uid: string) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
      alert("User deleted");
      setIsUserModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
    }
  };

  const saveStock = async (stock: Partial<Stock>) => {
    try {
      if (stock.id) {
        await updateDoc(doc(db, 'stocks', stock.id), stock);
      } else {
        await addDoc(collection(db, 'stocks'), stock);
      }
      setIsStockModalOpen(false);
      setEditingStock(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'stocks');
    }
  };

  const sendNotification = async (notif: Partial<Notification>) => {
    try {
      await addDoc(collection(db, 'notifications'), {
        ...notif,
        timestamp: new Date().toISOString()
      });
      setIsNotificationModalOpen(false);
      alert("Notification sent");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'notifications');
    }
  };

  const toggleFeature = async (feature: keyof FeatureFlags) => {
    if (!featureFlags) return;
    try {
      await updateDoc(doc(db, 'settings', 'features'), {
        [feature]: !featureFlags[feature]
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/features');
    }
  };

  const decideDeposit = async (id: string, decision: 'approved' | 'rejected') => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/deposits/${id}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-idempotency-key': `${id}-${decision}`
        },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process deposit');
      alert(data.message);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const decideWithdraw = async (id: string, decision: 'approved' | 'rejected') => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/withdraws/${id}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-idempotency-key': `${id}-${decision}`
        },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process withdrawal');
      alert(data.message);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter(u => 
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.uid.includes(searchQuery)
    );
  }, [users, searchQuery]);

  if (!isAuthReady) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4">
              <TrendingUp className="text-emerald-600 w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Fidelity Admin Pro</h1>
            <p className="text-slate-500">Secure Administrative Access</p>
          </div>
          
          <form onSubmit={handleAuth} className="space-y-4">
            {isRegistering && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                  placeholder="John Doe"
                  value={loginForm.name}
                  onChange={e => setLoginForm({ ...loginForm, name: e.target.value })}
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input 
                type="email" 
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                placeholder="admin@fidelity.com"
                value={loginForm.email}
                onChange={e => setLoginForm({ ...loginForm, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input 
                type="password" 
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                placeholder="••••••••"
                value={loginForm.password}
                onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl transition-colors shadow-lg shadow-emerald-200"
            >
              {isRegistering ? 'Create Admin Account' : 'Login to Dashboard'}
            </button>
          </form>
          
          <div className="mt-6 text-center">
            <button 
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-sm text-emerald-600 font-medium hover:underline"
            >
              {isRegistering ? 'Already have an account? Login' : 'Need an account? Register'}
            </button>
          </div>
          <p className="mt-4 text-center text-xs text-slate-400">
            Use your registered admin credentials.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F2F5] flex">
      {/* Sidebar */}
      <aside className={`bg-[#0F172A] text-slate-400 transition-all duration-300 ${isSidebarOpen ? 'w-[260px]' : 'w-20'} fixed h-full z-20 flex flex-col`}>
        <div className="p-6 flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-[#10B981] rounded-lg flex-shrink-0 flex items-center justify-center">
            <TrendingUp className="text-white w-5 h-5" />
          </div>
          {isSidebarOpen && (
            <span className="font-bold text-xl text-white tracking-tight uppercase">Fidelity Pro</span>
          )}
        </div>

        <nav className="flex-1">
          <NavItem 
            icon={<LayoutDashboard size={18} />} 
            label="Dashboard Overview" 
            active={activePage === 'dashboard'} 
            collapsed={!isSidebarOpen}
            onClick={() => setActivePage('dashboard')} 
          />
          <NavItem 
            icon={<Users size={18} />} 
            label="User Management" 
            active={activePage === 'users'} 
            collapsed={!isSidebarOpen}
            onClick={() => setActivePage('users')} 
          />
          <NavItem 
            icon={<Star size={18} />} 
            label="Stock & Injection" 
            active={activePage === 'stocks'} 
            collapsed={!isSidebarOpen}
            onClick={() => setActivePage('stocks')} 
          />
          <NavItem 
            icon={<Bell size={18} />} 
            label="Notifications" 
            active={activePage === 'notifications'} 
            collapsed={!isSidebarOpen}
            onClick={() => setActivePage('notifications')} 
          />
          <NavItem 
            icon={<Settings size={18} />} 
            label="Global Settings" 
            active={activePage === 'settings'} 
            collapsed={!isSidebarOpen}
            onClick={() => setActivePage('settings')} 
          />
          <NavItem 
            icon={<ShieldAlert size={18} />} 
            label="Audit Logs" 
            active={activePage === 'audit'} 
            collapsed={!isSidebarOpen}
            onClick={() => setActivePage('audit')} 
          />
        </nav>

        <div className="p-6 mt-auto border-t border-white/5">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 text-sm opacity-60 hover:opacity-100 transition-opacity w-full text-left"
          >
            <LogOut size={18} />
            {isSidebarOpen && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 transition-all duration-300 ${isSidebarOpen ? 'ml-[260px]' : 'ml-20'} flex flex-col min-h-screen`}>
        <header className="h-16 bg-white border-b border-[#E2E8F0] flex items-center justify-between px-8 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-100 rounded-lg">
              <Menu size={20} />
            </button>
            <div className="text-sm text-slate-500">
              Admin / <span className="text-[#1E293B] font-semibold capitalize">{activePage}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input 
                type="text" 
                placeholder="Search everything..."
                className="pl-10 pr-4 py-2 rounded border border-[#E2E8F0] text-sm outline-none focus:ring-1 focus:ring-[#10B981] transition-all w-64"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xs">
              AD
            </div>
          </div>
        </header>

        <div className="p-8 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              {activePage === 'dashboard' && (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="tech-stat-card">
                      <div className="tech-stat-label">Total Users</div>
                      <div className="tech-stat-value">{users.length}</div>
                      <div className="text-xs text-emerald-500 mt-2">+{users.filter(u => u.status === 'Active').length} Active</div>
                    </div>
                    <div className="tech-stat-card">
                      <div className="tech-stat-label">Platform Balance</div>
                      <div className="tech-stat-value">₹{users.reduce((acc, u) => acc + u.wallet_balance, 0).toLocaleString()}</div>
                      <div className="text-xs text-slate-400 mt-2">Total user funds</div>
                    </div>
                    <div className="tech-stat-card">
                      <div className="tech-stat-label">Pending Deposits</div>
                      <div className="tech-stat-value">{deposits.length}</div>
                      <div className="text-xs text-amber-500 mt-2">Action required</div>
                    </div>
                    <div className="tech-stat-card">
                      <div className="tech-stat-label">Withdrawal Requests</div>
                      <div className="tech-stat-value">{withdraws.length}</div>
                      <div className="text-xs text-rose-500 mt-2">High priority</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-sm">
                      <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <ArrowDownCircle className="text-emerald-500" size={18} />
                        Recent Deposits
                      </h3>
                      <div className="space-y-4">
                        {deposits.slice(0, 5).map(d => (
                          <div key={d.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                            <div>
                              <div className="font-bold text-slate-800">₹{d.amount.toLocaleString()}</div>
                              <div className="text-xs text-slate-500">UID: {d.user_uid}</div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => decideDeposit(d.id, 'approved')}
                                className="tech-btn tech-btn-primary text-xs py-1 px-3"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => decideDeposit(d.id, 'rejected')}
                                className="text-xs py-1 px-3 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ))}
                        {deposits.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">No pending deposits</div>}
                      </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-sm">
                      <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <ArrowUpCircle className="text-rose-500" size={18} />
                        Recent Withdrawals
                      </h3>
                      <div className="space-y-4">
                        {withdraws.slice(0, 5).map(w => (
                          <div key={w.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                            <div>
                              <div className="font-bold text-slate-800">₹{w.amount.toLocaleString()}</div>
                              <div className="text-xs text-slate-500">UID: {w.user_uid}</div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => decideWithdraw(w.id, 'approved')}
                                className="tech-btn tech-btn-primary text-xs py-1 px-3"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => decideWithdraw(w.id, 'rejected')}
                                className="text-xs py-1 px-3 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ))}
                        {withdraws.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">No pending withdrawals</div>}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activePage === 'users' && (
                <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden shadow-sm">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800">User Directory</h3>
                    <div className="flex gap-2">
                      <div className="text-xs text-slate-500 px-3 py-2 border rounded-lg">User creation is handled via signup flow</div>
                    </div>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50">
                        <th className="tech-table-header px-6 py-4">User Details</th>
                        <th className="tech-table-header px-6 py-4">Wallet</th>
                        <th className="tech-table-header px-6 py-4">Credit</th>
                        <th className="tech-table-header px-6 py-4">KYC</th>
                        <th className="tech-table-header px-6 py-4">Status</th>
                        <th className="tech-table-header px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredUsers.map(u => (
                        <tr key={u.uid} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold">
                                {u.name.charAt(0)}
                              </div>
                              <div>
                                <div className="font-bold text-slate-800">{u.name}</div>
                                <div className="text-xs text-slate-500">{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-mono font-bold text-[#10B981]">₹{u.wallet_balance.toLocaleString()}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-12 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500" style={{ width: `${u.credit_score}%` }} />
                              </div>
                              <span className="text-xs font-mono">{u.credit_score}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`tech-status-pill ${
                              u.kyc_status === 'Verified' ? 'bg-emerald-100 text-emerald-700' : 
                              u.kyc_status === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                            }`}>
                              {u.kyc_status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`tech-status-pill ${u.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                              {u.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right space-x-2">
                            <button 
                              onClick={() => { setSelectedUser(u); setIsUserModalOpen(true); }}
                              className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-[#10B981] transition-colors"
                            >
                              <Eye size={18} />
                            </button>
                            <button 
                              onClick={() => toggleUserActive(u.uid, u.is_active !== false)}
                              className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-rose-500 transition-colors"
                            >
                              {u.is_active !== false ? <Unlock size={18} className="text-emerald-500" /> : <Lock size={18} className="text-rose-500" />}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activePage === 'stocks' && (
                <div className="space-y-8">
                  <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden shadow-sm">
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                      <h3 className="font-bold text-slate-800">Stock Inventory</h3>
                      <button 
                        onClick={() => { setEditingStock({}); setIsStockModalOpen(true); }}
                        className="tech-btn flex items-center gap-2"
                      >
                        <Plus size={16} /> Add Stock
                      </button>
                    </div>
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50">
                          <th className="tech-table-header px-6 py-4">Symbol</th>
                          <th className="tech-table-header px-6 py-4">Name</th>
                          <th className="tech-table-header px-6 py-4">Price</th>
                          <th className="tech-table-header px-6 py-4">Order</th>
                          <th className="tech-table-header px-6 py-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {stocks.sort((a,b) => a.order - b.order).map(s => (
                          <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-mono font-bold text-slate-800">{s.symbol}</td>
                            <td className="px-6 py-4 text-slate-600">{s.name}</td>
                            <td className="px-6 py-4 font-mono">₹{s.price.toLocaleString()}</td>
                            <td className="px-6 py-4 font-mono">{s.order}</td>
                            <td className="px-6 py-4 text-right space-x-2">
                              <button 
                                onClick={() => { setEditingStock(s); setIsStockModalOpen(true); }}
                                className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-[#10B981]"
                              >
                                <Settings size={18} />
                              </button>
                              <button 
                                onClick={async () => { if(confirm("Delete stock?")) await deleteDoc(doc(db, 'stocks', s.id)); }}
                                className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-rose-500"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-sm">
                    <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                      <AlertTriangle className="text-amber-500" size={18} />
                      Injection System Control
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Target Stock</label>
                        <select className="w-full p-2 rounded border border-slate-200 text-sm outline-none" id="injectStockId">
                          {stocks.map(s => <option key={s.id} value={s.id}>{s.symbol} - {s.name}</option>)}
                        </select>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Injection Position</label>
                        <input type="number" placeholder="e.g. 7" className="w-full p-2 rounded border border-slate-200 text-sm outline-none" id="injectPosition" />
                      </div>
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Target User (UID)</label>
                        <input type="text" placeholder="Global if empty" className="w-full p-2 rounded border border-slate-200 text-sm outline-none" id="injectTargetUid" />
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const stockId = (document.getElementById('injectStockId') as HTMLSelectElement).value;
                        const position = Number((document.getElementById('injectPosition') as HTMLInputElement).value);
                        const targetUid = (document.getElementById('injectTargetUid') as HTMLInputElement).value;
                        if (!stockId || !Number.isFinite(position)) {
                          alert('Select stock and valid position');
                          return;
                        }
                        try {
                          const token = await auth.currentUser?.getIdToken();
                          const res = await fetch('/api/admin/injection-rules', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ stockId, position, target_uid: targetUid || null, active: true })
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || 'Failed to save rule');
                          alert('Injection rule saved');
                        } catch (err) {
                          alert((err as Error).message);
                        }
                      }}
                      className="mt-6 tech-btn tech-btn-primary w-full py-3"
                    >
                      Apply Injection Logic
                    </button>
                  </div>
                </div>
              )}

              {activePage === 'notifications' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-sm h-fit">
                    <h3 className="font-bold text-slate-800 mb-6">Compose Notification</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Target Audience</label>
                        <select className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" id="notifTarget">
                          <option value="all">All Users</option>
                          <option value="multi">Multiple Select</option>
                          <option value="single">Single User</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Single UID (for Single)</label>
                        <input type="text" className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" placeholder="user_uid" id="notifSingleUid" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Comma-separated UIDs (for Multi)</label>
                        <input type="text" className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" placeholder="uid1,uid2,uid3" id="notifMultiUids" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Alert Type</label>
                        <select className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" id="notifType">
                          <option value="info">Information (Blue)</option>
                          <option value="warning">Warning (Amber)</option>
                          <option value="success">Success (Green)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Title</label>
                        <input type="text" className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" placeholder="Notification Title" id="notifTitle" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message</label>
                        <textarea className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none min-h-[120px]" placeholder="Enter message details..." id="notifMsg" />
                      </div>
                      <button 
                        onClick={() => {
                          const title = (document.getElementById('notifTitle') as HTMLInputElement).value;
                          const message = (document.getElementById('notifMsg') as HTMLTextAreaElement).value;
                          const type = (document.getElementById('notifType') as HTMLSelectElement).value as any;
                          const target = (document.getElementById('notifTarget') as HTMLSelectElement).value;
                          const singleUid = (document.getElementById('notifSingleUid') as HTMLInputElement).value.trim();
                          const multiUidsRaw = (document.getElementById('notifMultiUids') as HTMLInputElement).value;
                          const multiUids = multiUidsRaw.split(',').map(v => v.trim()).filter(Boolean);

                          let target_uids: string[] = [];
                          if (target === 'all') target_uids = ['all'];
                          else if (target === 'single') target_uids = singleUid ? [singleUid] : [];
                          else if (target === 'multi') target_uids = multiUids;

                          if (!title || !message || target_uids.length === 0) {
                            alert('Provide title, message and valid target users');
                            return;
                          }
                          sendNotification({ title, message, type, target_uids });
                        }}
                        className="w-full tech-btn tech-btn-primary py-3 flex items-center justify-center gap-2"
                      >
                        <Bell size={18} /> Send Notification
                      </button>
                    </div>
                  </div>

                  <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden shadow-sm">
                    <div className="p-6 border-b border-slate-100">
                      <h3 className="font-bold text-slate-800">Notification History</h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {notifications.map(n => (
                        <div key={n.id} className="p-6 hover:bg-slate-50 transition-colors">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${
                                n.type === 'info' ? 'bg-blue-500' : n.type === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
                              }`} />
                              <h4 className="font-bold text-slate-800">{n.title}</h4>
                            </div>
                            <span className="text-xs text-slate-400">{new Date(n.timestamp).toLocaleString()}</span>
                          </div>
                          <p className="text-sm text-slate-600 mb-3">{n.message}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target: {n.target_uids.join(', ')}</span>
                            <button 
                              onClick={async () => { if(confirm("Delete notification?")) await deleteDoc(doc(db, 'notifications', n.id)); }}
                              className="text-xs text-rose-500 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                      {notifications.length === 0 && <div className="p-12 text-center text-slate-400">No history available</div>}
                    </div>
                  </div>
                </div>
              )}

              {activePage === 'settings' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-sm">
                    <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                      <Settings className="text-slate-400" size={18} />
                      Global Feature Switches
                    </h3>
                    <div className="space-y-6">
                      {featureFlags && Object.entries(featureFlags).map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between">
                          <div>
                            <div className="font-bold text-slate-800 capitalize">{key.replace(/_/g, ' ')}</div>
                            <div className="text-xs text-slate-500">Enable or disable this module platform-wide</div>
                          </div>
                          <button 
                            onClick={() => toggleFeature(key as keyof FeatureFlags)}
                            className={`w-12 h-6 rounded-full transition-colors relative ${val ? 'bg-[#10B981]' : 'bg-slate-200'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${val ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-sm">
                    <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                      <RefreshCw className="text-[#10B981]" size={18} />
                      Spin Reward System
                    </h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="font-bold text-slate-700">Feature Status</span>
                        <button
                          onClick={async () => {
                            if (!spinSettings) return;
                            try {
                              const token = await auth.currentUser?.getIdToken();
                              const res = await fetch('/api/admin/settings/spin', {
                                method: 'POST',
                                headers: {
                                  'Content-Type': 'application/json',
                                  'Authorization': `Bearer ${token}`
                                },
                                body: JSON.stringify({ enabled: !spinSettings.enabled, rewards: spinSettings.rewards })
                              });
                              const data = await res.json();
                              if (!res.ok) throw new Error(data.error || 'Failed to toggle spin settings');
                              alert(data.message || 'Spin settings updated');
                            } catch (err) {
                              alert((err as Error).message);
                            }
                          }}
                          className={`px-4 py-1.5 rounded-lg text-xs font-bold text-white ${spinSettings?.enabled ? 'bg-[#10B981]' : 'bg-slate-400'}`}
                        >
                          {spinSettings?.enabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Reward Probabilities</label>
                        {spinSettings?.rewards.map((r, i) => (
                          <div key={i} className="flex items-center gap-4 p-3 border border-slate-100 rounded-xl">
                            <div className="flex-1 font-bold text-slate-800">{r.label}</div>
                            <div className="w-24">
                              <input type="number" className="w-full p-1 text-xs border rounded" defaultValue={r.probability} id={`spinProb-${i}`} />
                            </div>
                            <div className="w-24 font-mono text-xs text-[#10B981]">₹{r.value}</div>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={async () => {
                          if (!spinSettings) return;
                          const rewards = spinSettings.rewards.map((r, i) => ({
                            ...r,
                            probability: Number((document.getElementById(`spinProb-${i}`) as HTMLInputElement).value)
                          }));
                          const enabled = spinSettings.enabled;
                          try {
                            const token = await auth.currentUser?.getIdToken();
                            const res = await fetch('/api/admin/settings/spin', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                              },
                              body: JSON.stringify({ enabled, rewards })
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error || 'Failed to update spin logic');
                            alert(data.message || 'Spin logic updated');
                          } catch (err) {
                            alert((err as Error).message);
                          }
                        }}
                        className="w-full tech-btn tech-btn-primary py-3"
                      >
                        Update Spin Logic
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activePage === 'audit' && (
                <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden shadow-sm">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800">Audit Logs</h3>
                    <div className="flex gap-2">
                      <input
                        value={auditActionFilter}
                        onChange={(e) => setAuditActionFilter(e.target.value)}
                        placeholder="Filter action"
                        className="px-3 py-2 rounded-lg border border-slate-200 text-sm"
                      />
                      <button
                        onClick={async () => {
                          try {
                            const token = await auth.currentUser?.getIdToken();
                            const params = new URLSearchParams({ limit: '500' });
                            if (auditActionFilter.trim()) params.set('action', auditActionFilter.trim());
                            const res = await fetch(`/api/admin/audit-logs/export?${params.toString()}`, {
                              headers: { Authorization: `Bearer ${token}` }
                            });
                            if (!res.ok) throw new Error('Export failed');
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `audit-logs-${new Date().toISOString()}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch (err) {
                            alert((err as Error).message);
                          }
                        }}
                        className="tech-btn"
                      >
                        Export CSV
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {auditLogs.filter(log => !auditActionFilter || String(log.action || '').includes(auditActionFilter)).map(log => (
                      <div key={log.id} className="p-4">
                        <div className="text-xs text-slate-500">{new Date(log.timestamp).toLocaleString()}</div>
                        <div className="font-semibold text-slate-800">{log.action}</div>
                        <div className="text-xs text-slate-500">Admin: {log.admin_uid} {log.target_uid ? `| Target: ${log.target_uid}` : ''}</div>
                      </div>
                    ))}
                    {auditLogs.length === 0 && <div className="p-12 text-center text-slate-400">No audit logs available</div>}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* User Detail Modal */}
      <Modal 
        isOpen={isUserModalOpen} 
        onClose={() => setIsUserModalOpen(false)} 
        title="User Profile Control" 
        size="full"
      >
        {selectedUser && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col items-center">
                <div className="w-24 h-24 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-3xl font-bold mb-4">
                  {selectedUser.name.charAt(0)}
                </div>
                <h4 className="text-xl font-bold text-slate-800">{selectedUser.name}</h4>
                <p className="text-sm text-slate-500 mb-4">{selectedUser.email}</p>
                <div className="flex gap-2">
                  <span className="tech-status-pill bg-emerald-100 text-emerald-700">{selectedUser.status}</span>
                  <span className="tech-status-pill bg-blue-100 text-blue-700">{selectedUser.role}</span>
                </div>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => window.open(`/profile.html?uid=${selectedUser.uid}`, '_blank')}
                  className="w-full tech-btn tech-btn-primary py-3 flex items-center justify-center gap-2"
                >
                  <Eye size={18} /> View User Dashboard
                </button>
                <button 
                  onClick={() => resetUserPassword(selectedUser.uid)}
                  className="w-full py-3 rounded-xl border border-emerald-200 text-emerald-600 font-bold hover:bg-emerald-50 transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw size={18} /> Reset Password
                </button>
                <button 
                  onClick={() => toggleUserActive(selectedUser.uid, selectedUser.is_active !== false)}
                  className={`w-full py-3 rounded-xl border font-bold transition-colors flex items-center justify-center gap-2 ${
                    selectedUser.is_active !== false 
                      ? 'border-amber-200 text-amber-600 hover:bg-amber-50' 
                      : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                  }`}
                >
                  {selectedUser.is_active !== false ? <Lock size={18} /> : <Unlock size={18} />}
                  {selectedUser.is_active !== false ? 'Disable Account' : 'Enable Account'}
                </button>
                <button 
                  onClick={() => deleteUser(selectedUser.uid)}
                  className="w-full py-3 rounded-xl border border-rose-200 text-rose-600 font-bold hover:bg-rose-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={18} /> Delete User Account
                </button>
                <button
                  onClick={async () => {
                    try {
                      const token = await auth.currentUser?.getIdToken();
                      const res = await fetch(`/api/admin/reconcile/user/${selectedUser.uid}`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${token}`
                        }
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || 'Reconciliation failed');
                      alert(`Reconciled balance: ₹${Number(data.computedBalance || 0).toLocaleString()}`);
                    } catch (err) {
                      alert((err as Error).message);
                    }
                  }}
                  className="w-full py-3 rounded-xl border border-blue-200 text-blue-600 font-bold hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw size={18} /> Reconcile Wallet
                </button>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-8">
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <h5 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                  <Settings size={16} /> Editable Fields
                </h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name</label>
                    <input type="text" className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" defaultValue={selectedUser.name} id="editName" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone Number</label>
                    <input type="text" className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" defaultValue={selectedUser.phone} id="editPhone" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Wallet Balance (₹)</label>
                    <input type="number" className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none font-mono font-bold text-[#10B981]" defaultValue={selectedUser.wallet_balance} id="editWallet" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Credit Score (0-100)</label>
                    <input type="number" className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none font-mono" defaultValue={selectedUser.credit_score} id="editCredit" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">KYC Status</label>
                    <select className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" defaultValue={selectedUser.kyc_status} id="editKYC">
                      <option value="Verified">Verified</option>
                      <option value="Pending">Pending</option>
                      <option value="Rejected">Rejected</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">UPI ID</label>
                    <input type="text" className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" defaultValue={selectedUser.upi_id} id="editUPI" />
                  </div>
                </div>
                <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <h6 className="text-xs font-bold text-slate-500 uppercase mb-3">Bank Details</h6>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <input type="text" placeholder="Bank Name" className="p-2 rounded border border-slate-200 text-sm outline-none" defaultValue={selectedUser.bank_details?.bank_name} id="editBankName" />
                    <input type="text" placeholder="Account Number" className="p-2 rounded border border-slate-200 text-sm outline-none" defaultValue={selectedUser.bank_details?.account_number} id="editAccNum" />
                    <input type="text" placeholder="IFSC Code" className="p-2 rounded border border-slate-200 text-sm outline-none" defaultValue={selectedUser.bank_details?.ifsc} id="editIFSC" />
                  </div>
                </div>
                <button 
                  onClick={() => {
                    const name = (document.getElementById('editName') as HTMLInputElement).value;
                    const phone = (document.getElementById('editPhone') as HTMLInputElement).value;
                    const wallet = Number((document.getElementById('editWallet') as HTMLInputElement).value);
                    const credit = Number((document.getElementById('editCredit') as HTMLInputElement).value);
                    const kyc = (document.getElementById('editKYC') as HTMLSelectElement).value as any;
                    const upi = (document.getElementById('editUPI') as HTMLInputElement).value;
                    const bankName = (document.getElementById('editBankName') as HTMLInputElement).value;
                    const accNum = (document.getElementById('editAccNum') as HTMLInputElement).value;
                    const ifsc = (document.getElementById('editIFSC') as HTMLInputElement).value;

                    updateUser(selectedUser.uid, {
                      name, phone, wallet_balance: wallet, credit_score: credit, kyc_status: kyc, upi_id: upi,
                      bank_details: { bank_name: bankName, account_number: accNum, ifsc }
                    });
                  }}
                  className="mt-8 w-full tech-btn tech-btn-primary py-4 flex items-center justify-center gap-2"
                >
                  <Save size={18} /> Save All Profile Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Stock Modal */}
      <Modal 
        isOpen={isStockModalOpen} 
        onClose={() => setIsStockModalOpen(false)} 
        title={editingStock?.id ? "Edit Stock" : "Add New Stock"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Symbol</label>
            <input 
              type="text" 
              className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" 
              defaultValue={editingStock?.symbol} 
              id="stockSymbol"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Name</label>
            <input 
              type="text" 
              className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none" 
              defaultValue={editingStock?.name} 
              id="stockName"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Price (₹)</label>
            <input 
              type="number" 
              className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none font-mono" 
              defaultValue={editingStock?.price} 
              id="stockPrice"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Display Order</label>
            <input 
              type="number" 
              className="w-full p-3 rounded-xl border border-slate-200 text-sm outline-none font-mono" 
              defaultValue={editingStock?.order} 
              id="stockOrder"
            />
          </div>
          <button 
            onClick={() => {
              const symbol = (document.getElementById('stockSymbol') as HTMLInputElement).value;
              const name = (document.getElementById('stockName') as HTMLInputElement).value;
              const price = Number((document.getElementById('stockPrice') as HTMLInputElement).value);
              const order = Number((document.getElementById('stockOrder') as HTMLInputElement).value);
              saveStock({ ...editingStock, symbol, name, price, order });
            }}
            className="w-full tech-btn tech-btn-primary py-3"
          >
            {editingStock?.id ? "Update Stock" : "Create Stock"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
