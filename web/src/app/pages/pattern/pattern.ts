import { Component, computed, inject } from '@angular/core';
import { PatternService } from '../../services/pattern';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap, catchError, of } from 'rxjs';
import { MarkdownComponent } from "ngx-markdown";
import { MatCardModule } from '@angular/material/card';
import { Landing } from "../landing/landing";
import { Layout } from "../../components/layout/layout";
import { MatChip } from "@angular/material/chips";
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-pattern',
  standalone: true,
  imports: [MarkdownComponent, MatCardModule, Landing, Layout, MatChip, MatButtonModule],
  templateUrl: './pattern.html',
  styleUrl: './pattern.scss'
})
export class Pattern {
  readonly patternService = inject(PatternService); 
  readonly activatedRoute = inject(ActivatedRoute);
  readonly activeId = toSignal(this.activatedRoute.params.pipe(map(params => params['id'] || undefined)));
  readonly http = inject(HttpClient);

  readonly pattern = computed(() => {
    const patterns = this.patternService.patterns();
    if (! patterns) {
      return undefined;
    }
    const activeId = this.activeId();
    if (! activeId) {
      return undefined;
    }
    return patterns.find(pattern => pattern.id === activeId);
  });

  readonly userStoryPreview = toSignal(
    this.activatedRoute.params.pipe(
      map(params => params['id']),
      switchMap(id => {
        if (!id) return of('');
        return this.http.get(`https://raw.githubusercontent.com/ai-standards/ai-design-patterns/refs/heads/main/patterns/${id}/user-story.md`, { 
          responseType: 'text' 
        }).pipe(
          map(res => res.toString().split('\n').slice(0, 12).join('\n')),
          catchError(error => {
            console.warn(`Could not fetch user story for pattern ${id}:`, error);
            return of('');
          })
        );
      })
    )
  );
}
