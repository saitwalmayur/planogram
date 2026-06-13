import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { PlanogramComponent } from './pages/planogram/planogram.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'planogram', component: PlanogramComponent }
];
