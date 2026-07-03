import { Routes } from '@angular/router';

const loadAskNora = () =>
  import('./features/ask-nora/ask-nora-page.component').then((m) => m.AskNoraPageComponent);

const loadGovernance = () =>
  import('./features/governance/governance-page.component').then((m) => m.GovernancePageComponent);

const loadAIChatOps = () =>
  import('./features/aichatops/aichatops-page.component').then((m) => m.AIChatOpsPageComponent);

export const appRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/product-choice/product-choice.component').then((m) => m.ProductChoiceComponent),
  },
  {
    path: 'ask-nora',
    loadComponent: loadAskNora,
  },
  {
    path: 'governance',
    loadComponent: loadGovernance,
  },
  {
    path: 'aichatops',
    loadComponent: loadAIChatOps,
  },
  {
    path: 'both',
    loadComponent: () =>
      import('./features/both/both-layout.component').then((m) => m.BothLayoutComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'ask-nora' },
      { path: 'ask-nora', loadComponent: loadAskNora },
      { path: 'governance', loadComponent: loadGovernance },
    ],
  },
  { path: '**', redirectTo: '' },
];
