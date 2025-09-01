import { Component, computed, Input, signal } from '@angular/core';
import { Section } from '../../lib/models/section';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { PatternNode } from '../pattern-node/pattern-node';

@Component({
  selector: 'app-section-node',
  imports: [
    MatIconModule,
    MatButtonModule,
    PatternNode
  ],
  templateUrl: './section-node.html',
  styleUrl: './section-node.scss'
})
export class SectionNode {
  @Input() section!: Section;

  readonly expanded = signal<boolean>(false);

  readonly classnames = computed(() => {
    const classnames = ['section-node'];
    if (this.expanded()) {
      classnames.push('section-node-expanded');
    }
    return classnames.join(' ');
  })

  toggle() {
    this.expanded.update(state => ! state);
  }
}
