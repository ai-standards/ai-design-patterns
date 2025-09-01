
import { Component, signal, ViewEncapsulation } from '@angular/core';

import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { RouterModule } from '@angular/router';
import { Breadcrumbs } from "../breadcrumbs/breadcrumbs";
import { PageToolbar } from "../page-toolbar/page-toolbar";
import {MatTreeModule} from '@angular/material/tree';
import { PatternTree } from '../pattern-tree/pattern-tree';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [MatSidenavModule, 
    MatToolbarModule, 
    MatTreeModule,
    MatButtonModule, 
    MatIconModule, 
    MatListModule, 
    MatDividerModule, MatExpansionModule, RouterModule, Breadcrumbs, PageToolbar,
    PatternTree
  ],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
  encapsulation: ViewEncapsulation.None,
})
export class Layout {
  readonly sidenavOpen = signal(true);

  toggleSidenav() {
    this.sidenavOpen.update(open => !open);
  }
}
