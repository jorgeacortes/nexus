/**
 * Port owned by the tasks context: sends a message back to a running agent.
 * Implemented over the Herdr socket; terminal harnesses only (Cursor is GUI).
 */
export interface AgentPromptPort {
  prompt(paneId: string, text: string): Promise<void>;
}
