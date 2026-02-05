
export interface Point {
  x: number;
  y: number;
  color: string;
  size: number;
  isNewStroke?: boolean;
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  TRACKING = 'TRACKING',
  ANALYZING = 'ANALYZING',
  ERROR = 'ERROR'
}

export interface DrawingSettings {
  color: string;
  brushSize: number;
}
