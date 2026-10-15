import { Inject, Injectable } from '@nestjs/common';
import { UserService } from '../users/user.service';

@Injectable()
export class SetupState {
  private completed = false;

  constructor(@Inject(UserService) private readonly users: UserService) {}

  async isRequired(): Promise<boolean> {
    if (this.completed) return false;
    const required = (await this.users.countUsers()) === 0;
    if (!required) this.completed = true;
    return required;
  }

  markCompleted(): void {
    this.completed = true;
  }
}
