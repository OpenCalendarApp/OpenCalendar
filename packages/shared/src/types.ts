export type UserRole = 'admin' | 'pm' | 'engineer';

export interface JwtPayload {
  userId: number;
  tenantId: number;
  tenantUid: string;
  email: string;
  role: UserRole;
}

export interface User {
  id: number;
  tenant_id: number;
  tenant_uid: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: UserRole;
  created_at: string;
  onboarding_completed_at: string | null;
}

export interface UserRecord extends User {
  password_hash: string;
  updated_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  booking_email_domain_allowlist: string | null;
  created_by: number;
  is_group_signup: boolean;
  max_group_size: number;
  session_length_minutes: number;
  share_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectRecord extends Project {
  signup_password_hash: string;
}

export interface TimeBlock {
  id: number;
  project_id: number;
  start_time: string;
  end_time: string;
  max_signups: number;
  is_personal: boolean;
  created_by: number;
  created_at: string;
}

export interface TimeBlockEngineer {
  id: number;
  time_block_id: number;
  engineer_id: number;
}

export interface Booking {
  id: number;
  time_block_id: number;
  client_first_name: string;
  client_last_name: string;
  client_email: string;
  client_phone: string;
  booking_token: string;
  booked_at: string;
  cancelled_at: string | null;
  session_notes: string | null;
}

export interface AvailableSlot {
  time_block_id: number;
  project_id: number;
  start_time: string;
  end_time: string;
  max_signups: number;
  remaining_slots: number;
}

export interface EngineerSummary {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

export interface PublicEngineerSummary {
  first_name: string;
  last_name: string;
}

export interface BookingWithRelations extends Booking {
  engineers: EngineerSummary[];
}

export interface TimeBlockWithRelations extends TimeBlock {
  remaining_slots: number;
  engineers: EngineerSummary[];
  bookings: Booking[];
}

export interface ProjectSummary extends Project {
  time_block_count: string;
  active_booking_count: string;
}

export interface ProjectDetail extends Project {
  creator_name: string;
  time_blocks: TimeBlockWithRelations[];
}

export interface AuthResponse {
  token: string;
  refresh_token: string;
  user: User;
}

export interface MeResponse {
  user: User;
}

export interface EngineersResponse {
  engineers: User[];
}

export interface MicrosoftCalendarAuthUrlResponse {
  authorization_url: string;
}

export interface OidcSsoAuthUrlResponse {
  authorization_url: string;
}

export interface MicrosoftCalendarStatusResponse {
  connected: boolean;
  account_email: string | null;
  token_expires_at: string | null;
}

export interface AdminOverviewStats {
  total_users: number;
  active_users: number;
  admins: number;
  pms: number;
  engineers: number;
  projects: number;
  active_projects: number;
  time_blocks: number;
  active_bookings: number;
}

export interface AdminOverviewResponse {
  stats: AdminOverviewStats;
}

export interface AdminUserSummary {
  id: number;
  tenant_id: number;
  tenant_uid: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminUsersResponse {
  users: AdminUserSummary[];
}

export interface AdminUserResponse {
  user: AdminUserSummary;
}

export interface AdminAuditEvent {
  id: number;
  tenant_id: number;
  actor_user_id: number | null;
  actor_role: UserRole | 'system';
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminAuditLogResponse {
  events: AdminAuditEvent[];
}

export interface AdminOidcSsoConfig {
  enabled: boolean;
  issuer_url: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  client_id: string;
  client_secret_configured: boolean;
  scopes: string;
  default_role: 'pm' | 'engineer';
  auto_provision: boolean;
  claim_email: string;
  claim_first_name: string;
  claim_last_name: string;
  success_redirect_url: string;
  error_redirect_url: string;
}

export interface AdminOidcSsoConfigResponse {
  config: AdminOidcSsoConfig;
}

export interface SetupStatusResponse {
  is_initialized: boolean;
  requires_setup: boolean;
  admin_user_count: number;
  tenant_count: number;
}

export interface SetupInitializeResponse extends AuthResponse {
  message: string;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface ProjectResponse {
  project: Project;
}

export interface ProjectDetailResponse {
  project: ProjectDetail;
}

export interface TimeBlocksResponse {
  time_blocks: TimeBlock[];
}

export interface PublicProjectInfo {
  id: number;
  name: string;
  description: string;
  booking_email_domain_allowlist: string | null;
  session_length_minutes: number;
  is_group_signup: boolean;
  share_token: string;
  tenant_uid: string;
}

export interface PublicSlotInfo {
  time_block_id: number;
  start_time: string;
  end_time: string;
  remaining_slots: number;
  engineers: PublicEngineerSummary[];
}

export interface PublicWaitlistSlotInfo {
  time_block_id: number;
  start_time: string;
  end_time: string;
  remaining_slots: number;
  waitlist_count: number;
  engineers: PublicEngineerSummary[];
}

export interface PublicProjectResponse {
  project: PublicProjectInfo;
  available_slots: PublicSlotInfo[];
  full_slots: PublicWaitlistSlotInfo[];
}

export interface CurrentBookingSlotInfo {
  time_block_id: number;
  start_time: string;
  end_time: string;
  engineers: PublicEngineerSummary[];
}

export interface BookingLookupResponse {
  project: PublicProjectInfo;
  booking: Booking;
  current_slot: CurrentBookingSlotInfo;
  available_slots: PublicSlotInfo[];
}

export interface BookingResponse {
  booking: Booking;
  client_calendar: string;
  engineer_calendars: Array<{
    engineer: EngineerSummary;
    ics: string;
  }>;
  reschedule_url: string;
}

export interface RescheduleResponse {
  booking: Booking;
  client_calendar: string;
  reschedule_url: string;
  message: string;
}

export interface CancelBookingResponse {
  booking: Booking;
  message: string;
}

export type WaitlistEntryStatus = 'active' | 'notified' | 'booked' | 'removed';

export interface WaitlistEntry {
  id: number;
  time_block_id: number;
  client_first_name: string;
  client_last_name: string;
  client_email: string;
  client_phone: string;
  status: WaitlistEntryStatus;
  notified_at: string | null;
  created_at: string;
}

export interface WaitlistJoinResponse {
  waitlist_entry: WaitlistEntry;
  message: string;
  already_exists: boolean;
}

export interface OnboardingStepStatus {
  calendar_connected: boolean;
  has_project: boolean;
  has_time_block: boolean;
  has_copied_link: boolean;
}

export interface OnboardingStatusResponse {
  completed: boolean;
  steps: OnboardingStepStatus;
}

export interface TenantBranding {
  logo_url: string | null;
  accent_color: string | null;
}

export interface TenantBrandingResponse {
  branding: TenantBranding;
}

export interface PublicTenantBrandingResponse {
  branding: TenantBranding;
}

export interface DashboardStats {
  active_projects: number;
  sessions_this_week: number;
  pending_bookings: number;
  upcoming_next_24h: number;
  team_members: number;
  total_bookings_this_month: number;
}

export interface DashboardStatsResponse {
  stats: DashboardStats;
}
