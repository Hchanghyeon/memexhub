export interface TaskList {
  id: string;
  title: string;
}
export interface Task {
  id: string;
  title: string;
  notes?: string;
  due?: string; // YYYY-MM-DD
  status: "needsAction" | "completed";
  parent?: string;
}

/** A to-do service (Google Tasks …). `list` may be a list id or its title; empty = the default list. */
export interface TaskProvider {
  lists(): Promise<TaskList[]>;
  list(list: string, o: { showCompleted: boolean; limit: number }): Promise<Task[]>;
  add(list: string, t: { title: string; notes?: string; due?: string }): Promise<Task>;
  update(list: string, id: string, p: { title?: string; notes?: string; due?: string | null }): Promise<Task>;
  complete(list: string, id: string, undo: boolean): Promise<Task>;
  remove(list: string, id: string): Promise<void>;
}
