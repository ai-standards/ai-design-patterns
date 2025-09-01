import { Component, computed, inject } from '@angular/core';
import { PatternService } from '../../services/pattern';
import {MatExpansionModule} from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Section } from '../../lib/models/section';
import { SectionNode } from '../section-node/section-node';





  const SECTION_DATA = [
    { id: 'generation', title: 'Generation Patterns', description: 'How models produce and manage outputs' },
    { id: 'governance', title: 'Governance Patterns', description: 'How AI teams organize discovery and make decisions' },
    { id: 'architecture', title: 'Architecture Patterns', description: 'How AI systems are structured' },
    { id: 'operational', title: 'Operations Patterns', description: 'How AI systems are launched, monitored, and controlled' },
    { id: 'automation-strategies', title: 'Automation Strategies', description: 'How agentic systems execute real work under constraints' },
    { id: 'anti-patterns', title: 'Anti-Patterns', description: 'The dead ends and approaches to avoid' }
  ];

@Component({
  selector: 'app-pattern-tree',
  imports: [
    MatExpansionModule, 
    MatButtonModule,
    MatIconModule,
    SectionNode
  ],
  templateUrl: './pattern-tree.html',
  styleUrl: './pattern-tree.scss'
})
export class PatternTree {
  readonly patternService = inject(PatternService);

  readonly sections = computed(() => {
    const patterns = this.patternService.patterns();
    if (!patterns) return [];

    const index = SECTION_DATA.map(section => ({
      ...section,
      patterns: patterns.filter(p => p.section === section.id)
    }));

    return index as Section[];
  })

}
