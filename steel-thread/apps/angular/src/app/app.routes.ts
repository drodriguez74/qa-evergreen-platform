import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { LoginComponent } from './login.component';
import { DashboardComponent } from './dashboard.component';
import { TransferComponent } from './transfer.component';
import { ReviewComponent } from './review.component';
import { ReceiptComponent } from './receipt.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'transfer', component: TransferComponent, canActivate: [authGuard] },
  {
    path: 'transfer/review',
    component: ReviewComponent,
    canActivate: [authGuard],
  },
  {
    path: 'transfer/receipt/:id',
    component: ReceiptComponent,
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'login' },
];
