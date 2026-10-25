'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api, SystemSettings, User as UserType, LoginLog } from '@/lib/api';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Globe,
  Network,
  Shield,
  ShieldCheck,
  Save,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  Users,
  Plus,
  Search,
  Trash2,
  Edit,
  History,
  UserCheck,
  UserX,
  Lock,
  RefreshCw,
  Monitor,
  Smartphone,
  CheckCircle2,
} from 'lucide-react';

export default function AdminSettingsPage() {
  const router = useRouter();
  const { user: currentUser, isLoading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<'users' | 'registration' | 'domain'>('users');

  // Settings State
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [primaryDomain, setPrimaryDomain] = useState('');
  const [alternativeDomain, setAlternativeDomain] = useState('');
  const [registrationMode, setRegistrationMode] = useState<'open' | 'approval' | 'closed'>('open');

  // User Management State
  const [users, setUsers] = useState<UserType[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'disabled'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'superadmin' | 'crew'>('all');

  // Create User Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsSuperadmin, setNewIsSuperadmin] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);

  // Edit User Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserType | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editIsSuperadmin, setEditIsSuperadmin] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete User Confirmation Modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserType | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  // Login Logs Modal
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logsUser, setLogsUser] = useState<UserType | null>(null);
  const [userLogs, setUserLogs] = useState<LoginLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Auth Guard
  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push('/login');
    }
  }, [currentUser, authLoading, router]);

  // Load Settings
  const fetchSettings = async () => {
    if (!currentUser?.is_superadmin) return;
    try {
      setLoadingSettings(true);
      const data = await api.getSettings();
      setSettings(data);
      setPrimaryDomain(data.primary_domain || '');
      setAlternativeDomain(data.alternative_domain || '');
      setRegistrationMode(data.registration_mode || 'open');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load system settings';
      toast.error(msg);
    } finally {
      setLoadingSettings(false);
    }
  };

  // Load Users
  const fetchUsers = async () => {
    if (!currentUser?.is_superadmin) return;
    try {
      setLoadingUsers(true);
      const data = await api.listAdminUsers({
        query: searchQuery.trim() || undefined,
        status_filter: statusFilter,
        role_filter: roleFilter,
      });
      setUsers(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load users';
      toast.error(msg);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (currentUser?.is_superadmin) {
      fetchSettings();
      fetchUsers();
    }
  }, [currentUser]);

  // Handle Search & Filter changes
  useEffect(() => {
    if (currentUser?.is_superadmin) {
      const timer = setTimeout(() => {
        fetchUsers();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [searchQuery, statusFilter, roleFilter]);

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const updated = await api.updateSettings({
        primary_domain: primaryDomain.trim() || null,
        alternative_domain: alternativeDomain.trim() || null,
        registration_mode: registrationMode,
      });
      setSettings(updated);
      setPrimaryDomain(updated.primary_domain || '');
      setAlternativeDomain(updated.alternative_domain || '');
      setRegistrationMode(updated.registration_mode || 'open');
      toast.success('Admin settings updated successfully!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update settings';
      toast.error(msg);
    } finally {
      setSavingSettings(false);
    }
  };

  // Create User Handler
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullName.trim() || !newEmail.trim() || !newPassword) {
      toast.error('Please fill in all required fields');
      return;
    }
    setCreatingUser(true);
    try {
      await api.createAdminUser({
        full_name: newFullName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        is_superadmin: newIsSuperadmin,
      });
      toast.success(`User '${newEmail.trim()}' created successfully!`);
      setShowCreateModal(false);
      setNewFullName('');
      setNewEmail('');
      setNewPassword('');
      setNewIsSuperadmin(false);
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create user';
      toast.error(msg);
    } finally {
      setCreatingUser(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (u: UserType) => {
    setEditingUser(u);
    setEditFullName(u.full_name || '');
    setEditEmail(u.email);
    setEditPassword('');
    setEditIsSuperadmin(u.is_superadmin);
    setShowEditModal(true);
  };

  // Save User Edit Handler
  const handleSaveUserEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      await api.updateAdminUser(editingUser.id, {
        full_name: editFullName.trim() || undefined,
        email: editEmail.trim() || undefined,
        is_superadmin: editIsSuperadmin,
        password: editPassword.trim() || undefined,
      });
      toast.success('User updated successfully!');
      setShowEditModal(false);
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update user';
      toast.error(msg);
    } finally {
      setSavingEdit(false);
    }
  };

  // Toggle User Status (Enable / Disable)
  const handleToggleUserStatus = async (u: UserType) => {
    try {
      const nextActive = !u.is_active;
      await api.updateAdminUserStatus(u.id, { is_active: nextActive });
      toast.success(`User account ${nextActive ? 'enabled' : 'disabled'}`);
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update user status';
      toast.error(msg);
    }
  };

  // Approve Pending Registration
  const handleApproveRegistration = async (u: UserType) => {
    try {
      await api.updateAdminUserStatus(u.id, { approval_status: 'approved' });
      toast.success(`Account for '${u.email}' approved successfully!`);
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to approve registration';
      toast.error(msg);
    }
  };

  // Delete User Handler
  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setDeletingUser(true);
    try {
      await api.deleteAdminUser(userToDelete.id);
      toast.success(`User '${userToDelete.email}' deleted.`);
      setShowDeleteModal(false);
      setUserToDelete(null);
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete user';
      toast.error(msg);
    } finally {
      setDeletingUser(false);
    }
  };

  // View Logon History Handler
  const openLogsModal = async (u: UserType) => {
    setLogsUser(u);
    setShowLogsModal(true);
    setLoadingLogs(true);
    try {
      const logs = await api.getUserLoginLogs(u.id);
      setUserLogs(logs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch login logs';
      toast.error(msg);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Format relative time helper
  const formatTimeAgo = (dateStr?: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return date.toLocaleDateString();
  };

  if (authLoading || (loadingSettings && !settings)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Permission Guard
  if (!currentUser?.is_superadmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-lg mx-auto px-4 flex flex-col items-center justify-center text-center">
          <Card className="p-8 max-w-md w-full shadow-sm text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mb-4">
              <Shield className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Superadmin Access Required</h2>
            <p className="text-sm text-muted-foreground mt-2 mb-6 leading-relaxed">
              Global system administration and user management can only be accessed by Lead Superadmins.
            </p>
            <Button onClick={() => router.push('/')} className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Dashboard</span>
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.push('/')}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Admin Settings
              </h1>
            </div>
            <p className="text-sm text-muted-foreground pl-10">
              Manage global users, authentication policy, and domain network configurations.
            </p>
          </div>

          {activeTab === 'users' && (
            <Button onClick={() => setShowCreateModal(true)} className="gap-2 shadow-sm">
              <Plus className="w-4 h-4" />
              <span>Add User</span>
            </Button>
          )}
        </div>

        {/* Navigation Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as 'users' | 'registration' | 'domain')}
          className="space-y-6"
        >
          <TabsList className="bg-muted p-1">
            <TabsTrigger value="users" className="gap-2">
              <Users className="w-4 h-4" />
              <span>User Management</span>
            </TabsTrigger>
            <TabsTrigger value="registration" className="gap-2">
              <ShieldCheck className="w-4 h-4" />
              <span>Registration Policy</span>
            </TabsTrigger>
            <TabsTrigger value="domain" className="gap-2">
              <Globe className="w-4 h-4" />
              <span>Domain &amp; Network</span>
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: USER MANAGEMENT */}
          <TabsContent value="users" className="space-y-4">
            {/* Search and Filters Bar */}
            <Card className="p-4 shadow-sm">
              <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
                <div className="relative w-full md:w-80">
                  <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    type="text"
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto justify-end flex-wrap">
                  {/* Status Filter */}
                  <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border/60 text-xs">
                    {(['all', 'active', 'pending', 'disabled'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStatusFilter(s)}
                        className={`px-2.5 py-1 rounded-md capitalize transition-colors font-medium ${
                          statusFilter === s
                            ? 'bg-background text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {s === 'pending' ? 'Pending Approval' : s}
                      </button>
                    ))}
                  </div>

                  {/* Refresh Button */}
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={fetchUsers}
                    title="Refresh user list"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>
            </Card>

            {/* Users Table */}
            <Card className="shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latest Logon</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingUsers ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          <span>Loading crew accounts...</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                        No users found matching your filter criteria.
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((u) => {
                      const isPending = u.approval_status === 'pending';
                      const isSelf = u.id === currentUser.id;

                      return (
                        <TableRow key={u.id}>
                          {/* User info */}
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                                {(u.full_name || u.email).substring(0, 2).toUpperCase()}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="font-semibold text-foreground truncate text-sm">
                                  {u.full_name || 'No Name'}
                                  {isSelf && (
                                    <span className="ml-1.5 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-normal">
                                      You
                                    </span>
                                  )}
                                </span>
                                <span className="text-xs text-muted-foreground truncate font-mono">
                                  {u.email}
                                </span>
                              </div>
                            </div>
                          </TableCell>

                          {/* Role */}
                          <TableCell>
                            {u.is_superadmin ? (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[11px]">
                                Lead Superadmin
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-muted text-muted-foreground text-[11px]">
                                Crew Member
                              </Badge>
                            )}
                          </TableCell>

                          {/* Status */}
                          <TableCell>
                            {isPending ? (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[11px]">
                                Pending Approval
                              </Badge>
                            ) : u.is_active ? (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[11px]">
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-[11px]">
                                Disabled
                              </Badge>
                            )}
                          </TableCell>

                          {/* Latest Logon */}
                          <TableCell>
                            {u.last_login_at ? (
                              <div className="flex flex-col text-xs">
                                <div className="flex items-center gap-1.5 text-foreground font-medium">
                                  <span>{formatTimeAgo(u.last_login_at)}</span>
                                  {u.last_login_ip && (
                                    <span className="text-muted-foreground font-mono text-[11px]">
                                      ({u.last_login_ip})
                                    </span>
                                  )}
                                </div>
                                {(u.last_login_device || u.last_login_browser) && (
                                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                                    {u.last_login_device === 'iPhone' || u.last_login_device === 'iPad' || u.last_login_device === 'Android' ? (
                                      <Smartphone className="w-3 h-3 text-muted-foreground shrink-0" />
                                    ) : (
                                      <Monitor className="w-3 h-3 text-muted-foreground shrink-0" />
                                    )}
                                    <span>
                                      {[u.last_login_device, u.last_login_browser].filter(Boolean).join(' • ')}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {/* Approve action for pending accounts */}
                              {isPending && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleApproveRegistration(u)}
                                  className="h-8 text-xs text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 gap-1 px-2"
                                  title="Approve registration"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Approve</span>
                                </Button>
                              )}

                              {/* View Login Logs */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => openLogsModal(u)}
                                title="View Login History"
                              >
                                <History className="w-4 h-4" />
                              </Button>

                              {/* Enable / Disable */}
                              {!isSelf && !isPending && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`h-8 w-8 ${
                                    u.is_active
                                      ? 'text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10'
                                      : 'text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10'
                                  }`}
                                  onClick={() => handleToggleUserStatus(u)}
                                  title={u.is_active ? 'Disable account' : 'Enable account'}
                                >
                                  {u.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                                </Button>
                              )}

                              {/* Edit User */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => openEditModal(u)}
                                title="Edit user"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>

                              {/* Delete User */}
                              {!isSelf && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => {
                                    setUserToDelete(u);
                                    setShowDeleteModal(true);
                                  }}
                                  title="Delete user"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* TAB 2: REGISTRATION POLICY */}
          <TabsContent value="registration">
            <Card className="shadow-sm">
              <form onSubmit={handleSaveSettings}>
                <CardHeader>
                  <CardTitle className="text-lg">Crew Registration Policy</CardTitle>
                  <CardDescription className="text-xs">
                    Control who can register for accounts on this StageControl instance.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Open */}
                    <div
                      onClick={() => setRegistrationMode('open')}
                      className={`cursor-pointer rounded-xl border p-4 transition-all flex flex-col justify-between ${
                        registrationMode === 'open'
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border/60 hover:border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm text-foreground">Open Registration</span>
                          <input
                            type="radio"
                            name="reg_mode"
                            checked={registrationMode === 'open'}
                            onChange={() => setRegistrationMode('open')}
                            className="text-primary"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Anyone with access to the login page can register an account and immediately log in.
                        </p>
                      </div>
                      <Badge variant="outline" className="mt-4 w-fit bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]">
                        Public / Internal Team
                      </Badge>
                    </div>

                    {/* Approval */}
                    <div
                      onClick={() => setRegistrationMode('approval')}
                      className={`cursor-pointer rounded-xl border p-4 transition-all flex flex-col justify-between ${
                        registrationMode === 'approval'
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border/60 hover:border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm text-foreground">Approval Required</span>
                          <input
                            type="radio"
                            name="reg_mode"
                            checked={registrationMode === 'approval'}
                            onChange={() => setRegistrationMode('approval')}
                            className="text-primary"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Users can register, but their account remains locked until an administrator approves them.
                        </p>
                      </div>
                      <Badge variant="outline" className="mt-4 w-fit bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px]">
                        Moderated Access
                      </Badge>
                    </div>

                    {/* Closed */}
                    <div
                      onClick={() => setRegistrationMode('closed')}
                      className={`cursor-pointer rounded-xl border p-4 transition-all flex flex-col justify-between ${
                        registrationMode === 'closed'
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border/60 hover:border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm text-foreground">Closed (Invite Only)</span>
                          <input
                            type="radio"
                            name="reg_mode"
                            checked={registrationMode === 'closed'}
                            onChange={() => setRegistrationMode('closed')}
                            className="text-primary"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Public registration is completely disabled. Only administrators can create new users in User Management.
                        </p>
                      </div>
                      <Badge variant="outline" className="mt-4 w-fit bg-destructive/10 text-destructive border-destructive/20 text-[10px]">
                        Private Instance
                      </Badge>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end gap-3 px-6 py-4 border-t border-border/60 bg-muted/20">
                  <Button type="submit" disabled={savingSettings} className="gap-2 shadow-sm">
                    {savingSettings ? (
                      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>Save Policy</span>
                      </>
                    )}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          {/* TAB 3: DOMAIN & NETWORK SETTINGS */}
          <TabsContent value="domain">
            <Card className="shadow-sm">
              <form onSubmit={handleSaveSettings}>
                <CardHeader>
                  <CardTitle className="text-lg">Domain &amp; Network Configuration</CardTitle>
                  <CardDescription className="text-xs">
                    Configure the global canonical domain and fallback LAN domain for audience links, teleprompter, and crew comms.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Primary Global Domain */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-primary" />
                      <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                        Primary Global Domain
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The canonical public URL used when generating shareable links, 6-digit PIN invites, and teleprompter displays.
                    </p>
                    <Input
                      type="text"
                      placeholder="https://stagecontrol.yourdomain.com (or http://localhost:3000)"
                      value={primaryDomain}
                      onChange={(e) => setPrimaryDomain(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <span className="text-[11px] text-muted-foreground block">
                      Leave blank or set to your public domain (e.g. <code className="text-foreground">https://stage.myschool.edu</code>).
                    </span>
                  </div>

                  {/* Alternative Domain / LAN Fallback */}
                  <div className="pt-6 border-t border-border/60 space-y-2">
                    <div className="flex items-center gap-2">
                      <Network className="w-4 h-4 text-purple-400" />
                      <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                        Alternative Domain / Local LAN Fallback
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Secondary domain or local LAN IP address. Essential when event crew or student devices operate on an isolated local Wi-Fi router without internet access.
                    </p>
                    <Input
                      type="text"
                      placeholder="http://192.168.1.100:3000 or https://backup.yourdomain.com"
                      value={alternativeDomain}
                      onChange={(e) => setAlternativeDomain(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <span className="text-[11px] text-muted-foreground block">
                      Example: Local venue IP like <code className="text-foreground">http://10.0.1.50:3000</code> or backup tunnel.
                    </span>
                  </div>
                </CardContent>

                <CardFooter className="flex items-center justify-end gap-3 px-6 sm:px-8 py-4 border-t border-border/60 bg-muted/20">
                  <Button type="submit" disabled={savingSettings} className="gap-2 shadow-sm">
                    {savingSettings ? (
                      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>Save Domain Settings</span>
                      </>
                    )}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* CREATE USER DIALOG */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              <span>Add New Crew Account</span>
            </DialogTitle>
            <DialogDescription>
              Create an account directly. The user can log in immediately with the credentials you set.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Full Name *
              </label>
              <Input
                type="text"
                required
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="e.g. Jordan Smith"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Email Address *
              </label>
              <Input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="jordan@crew.org"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Password *
              </label>
              <Input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
              />
            </div>

            <div className="pt-2 flex items-center gap-2">
              <input
                type="checkbox"
                id="create_superadmin"
                checked={newIsSuperadmin}
                onChange={(e) => setNewIsSuperadmin(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="create_superadmin" className="text-xs font-medium cursor-pointer text-foreground">
                Grant Lead Superadmin privileges
              </label>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingUser}>
                {creatingUser ? 'Creating...' : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT USER DIALOG */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5 text-primary" />
              <span>Edit User Account</span>
            </DialogTitle>
            <DialogDescription>
              Update user profile details or set a new password.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveUserEdit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Full Name
              </label>
              <Input
                type="text"
                required
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Email Address
              </label>
              <Input
                type="email"
                required
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Reset Password <span className="text-muted-foreground font-normal">(Optional)</span>
              </label>
              <Input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="Leave blank to keep unchanged"
              />
            </div>

            {editingUser?.id !== currentUser.id && (
              <div className="pt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="edit_superadmin"
                  checked={editIsSuperadmin}
                  onChange={(e) => setEditIsSuperadmin(e.target.checked)}
                  className="rounded border-border"
                />
                <label htmlFor="edit_superadmin" className="text-xs font-medium cursor-pointer text-foreground">
                  Lead Superadmin privileges
                </label>
              </div>
            )}

            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={() => setShowEditModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* LOGIN LOGS MODAL */}
      <Dialog open={showLogsModal} onOpenChange={setShowLogsModal}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              <span>Login Activity History</span>
            </DialogTitle>
            <DialogDescription>
              Showing past login sessions for <strong className="text-foreground">{logsUser?.email}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-2">
            {loadingLogs ? (
              <div className="h-32 flex items-center justify-center gap-2 text-muted-foreground">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>Loading activity history...</span>
              </div>
            ) : userLogs.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                No recorded login sessions found for this user.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Browser</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-foreground">
                        {new Date(log.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.ip_address || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-foreground">
                        {log.device || 'Unknown'}
                      </TableCell>
                      <TableCell className="text-xs text-foreground">
                        {log.browser || 'Unknown'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setShowLogsModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE USER CONFIRMATION DIALOG */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              <span>Delete User Account</span>
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete account <strong className="text-foreground">{userToDelete?.email}</strong>? This will remove all their permissions and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-4">
            <Button type="button" variant="ghost" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={deletingUser}>
              {deletingUser ? 'Deleting...' : 'Delete User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
