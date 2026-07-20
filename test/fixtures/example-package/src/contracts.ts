/** Provides a service. */
export interface Service {
  /** Starts the service. */
  start(port: number): void;
}

/** Current service status. */
export enum Status {
  Ready,
  Stopped
}

/** A service identifier. */
export type Identifier = string | number;
