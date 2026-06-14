import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main>
      <h1>Sign in to FundFlow</h1>
      <div class="card">
        <form (ngSubmit)="submit()">
          <label for="username">Username</label>
          <input
            id="username"
            name="username"
            type="text"
            [(ngModel)]="username"
            autocomplete="username"
          />

          <label for="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            [(ngModel)]="password"
            autocomplete="current-password"
          />

          @if (error) {
            <div role="alert">{{ error }}</div>
          }

          <button type="submit" [disabled]="loading">Sign in</button>
        </form>
      </div>
    </main>
  `,
})
export class LoginComponent {
  username = '';
  password = '';
  error = '';
  loading = false;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  submit(): void {
    this.error = '';
    this.loading = true;
    this.auth.login(this.username, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.loading = false;
        // Contract: exact text, only on a failed login (401).
        this.error = 'Invalid username or password';
      },
    });
  }
}
