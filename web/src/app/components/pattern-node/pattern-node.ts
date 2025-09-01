import { Component, Input } from '@angular/core';
import { Pattern } from '../../lib/models/pattern';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-pattern-node',
  imports: [
    MatIconModule,
    RouterLink
  ],
  templateUrl: './pattern-node.html',
  styleUrl: './pattern-node.scss'
})
export class PatternNode {
  @Input() pattern!: Pattern;
}
