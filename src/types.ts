export interface EnrolledFinger {
  fingerName: string; // e.g. "Right Index", "Right Thumb", "Left Index", etc.
  templateData: string; // Base64 biometric template
  BMPBase64?: string;
  ErrorCode?: number;
  ISOTemplateBase64?: string;
  ImageDPI?: number;
  ImageDataBase64?: string | null;
  ImageHeight?: number;
  ImageQuality?: number;
  ImageWidth?: number;
  Manufacturer?: string;
  Model?: string;
  NFIQ?: number;
  SerialNumber?: string;
  TemplateBase64?: string;
}

export interface User {
  id: string; // e.g. EMP-101, EMP-102
  name: string;
  department: string;
  designation: string;
  email: string;
  phone: string;
  fingerprintId: string | null; // Associated scanner ID, e.g. "FP-01"
  status: 'Present' | 'Late' | 'Absent' | 'Inactive';
  avatar?: string;
  joinedDate: string;
  fingers?: EnrolledFinger[]; // Multiple registered fingers
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  userDepartment: string;
  date: string; // YYYY-MM-DD
  checkIn: string; // HH:MM:SS AM/PM
  checkOut?: string;
  status: 'Present' | 'Late' | 'Absent';
  method: 'Fingerprint' | 'Manual' | 'API';
}

export interface LiveLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  type: 'scan_success' | 'scan_failed' | 'enroll_start' | 'enroll_success' | 'device_connected' | 'device_disconnected';
  message: string;
}

export interface HardwareSettings {
  port: string;
  baudRate: number;
  connectionType: 'USB_SERIAL' | 'LOCAL_IP' | 'SIMULATOR';
  deviceIp: string;
  autoLog: boolean;
}
