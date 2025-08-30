import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PatternService } from '../../services/pattern';

@Component({
  selector: 'app-patterns',
  imports: [RouterLink, TitleCasePipe, MatCardModule, MatChipsModule, MatButtonModule, MatIconModule],
  templateUrl: './patterns.html',
  styleUrl: './patterns.scss'
})
export class Patterns {
  readonly patternService = inject(PatternService);

  readonly patterns = computed(() => {
    const patterns = this.patternService.patterns();
    return patterns || [];
  })
}
