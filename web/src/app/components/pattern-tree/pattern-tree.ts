import { Component, computed, inject } from '@angular/core';
import { PatternService } from '../../services/pattern';

@Component({
  selector: 'app-pattern-tree',
  imports: [],
  templateUrl: './pattern-tree.html',
  styleUrl: './pattern-tree.scss'
})
export class PatternTree {
  readonly patternService = inject(PatternService);
    readonly sectionData = [
      { id: 'generation', title: 'Generation Patterns', blurb: 'How models produce and manage outputs' },
      { id: 'governance', title: 'Governance Patterns', blurb: 'How AI teams organize discovery and make decisions' },
      { id: 'architecture', title: 'Architecture Patterns', blurb: 'How AI systems are structured' },
      { id: 'operational', title: 'Operations Patterns', blurb: 'How AI systems are launched, monitored, and controlled' },
      { id: 'automation-strategies', title: 'Automation Strategies', blurb: 'How agentic systems execute real work under constraints' },
      { id: 'anti-patterns', title: 'Anti-Patterns', blurb: 'The dead ends and approaches to avoid' }
    ];

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

}
