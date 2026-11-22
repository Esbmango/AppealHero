import type { User } from '@appealhero/shared';
import { HttpError } from '../util';
import { readJson, writeJsonAtomic } from './json';

/** Accounts (owner of the behaviour: WP1). WP0 fixes the interface and a JSON-file implementation. */
export interface UserRepo {
  get(id: string): User | undefined;
  must(id: string): User;
  put(user: User): void;
  list(): User[];
  reset(): void;
  flush(): void;
}

export class JsonUserRepo implements UserRepo {
  private users = new Map<string, User>();
  private timer: NodeJS.Timeout | null = null;
  constructor(private file: string | null) {
    for (const u of readJson<User[]>(file, [])) this.users.set(u.id, u);
  }
  get(id: string) {
    return this.users.get(id);
  }
  must(id: string) {
    const u = this.users.get(id);
    if (!u) throw new HttpError(404, `user ${id} not found`);
    return u;
  }
  put(user: User) {
    this.users.set(user.id, user);
    this.saveSoon();
  }
  list() {
    return [...this.users.values()];
  }
  reset() {
    this.users.clear();
    this.saveSoon();
  }
  private saveSoon() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 50);
  }
  flush() {
    if (this.file) writeJsonAtomic(this.file, this.list());
  }
}
