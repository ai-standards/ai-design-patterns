import { Component, computed, inject, signal, ViewEncapsulation } from '@angular/core';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { RouterModule } from '@angular/router';
import { PatternService } from '../../services/pattern';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [MatSidenavModule, MatToolbarModule, MatButtonModule, MatIconModule, MatListModule, MatDividerModule, MatExpansionModule, RouterModule],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
  encapsulation: ViewEncapsulation.None
})
export class Layout {
  readonly patternService = inject(PatternService);

  readonly sidenavOpen = signal(true);
  readonly sections = computed(() => {
    // Fixed order for sections with titles and blurbs
    const sectionData = [
      { id: 'generation', title: 'Generation Patterns', blurb: 'How models produce and manage outputs' },
      { id: 'governance', title: 'Governance Patterns', blurb: 'How AI teams organize discovery and make decisions' },
      { id: 'architecture', title: 'Architecture Patterns', blurb: 'How AI systems are structured' },
      { id: 'operational', title: 'Operations Patterns', blurb: 'How AI systems are launched, monitored, and controlled' },
      { id: 'automation-strategies', title: 'Automation Strategies', blurb: 'How agentic systems execute real work under constraints' },
      { id: 'anti-patterns', title: 'Anti-Patterns', blurb: 'The dead ends and approaches to avoid' }
    ];
    
    return sectionData;
  });

  readonly index = computed(() => {
    const patterns = this.patternService.patterns();
    if (!patterns) return {};
    
    const index: Record<string, any[]> = {};
    
    patterns.forEach(pattern => {
      if (!index[pattern.section]) {
        index[pattern.section] = [];
      }
      index[pattern.section].push({
        id: pattern.id,
        title: pattern.title,
        blurb: pattern.description
      });
    });
    
    return index;
  });

  toggleSidenav() {
    this.sidenavOpen.update(open => !open);
  }

  showInfo(pattern: any) {
    // Show pattern info - could be a tooltip, dialog, or navigation
    console.log('Pattern info:', pattern);
  }
}
