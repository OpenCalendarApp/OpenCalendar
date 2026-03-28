export type UserRole = 'pm' | 'engineer';

export interface JwtPayload {
  userId: number;
  email: string;
  role: UserRole;
}

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: UserRole;
  created_at: string;
}

export interface UserRecord extends User {
  password_hash: string;
  updated_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
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
  user: User;
}

export interface MeResponse {
  user: User;
}

export interface EngineersResponse {
  engineers: User[];
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

export interface PublicProjectInfo {
  id: number;
  name: string;
  description: string;
  session_length_minutes: number;
  is_group_signup: boolean;
  share_token: string;
}

export interface PublicSlotInfo {
  time_block_id: number;
  start_time: string;
  end_time: string;
  remaining_slots: number;
  engineers: PublicEngineerSummary[];
}

export interface PublicProjectResponse {
  project: PublicProjectInfo;
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
  message: string;
}
