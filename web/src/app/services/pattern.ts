import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, from, map, Observable, switchMap } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { PatternIndex, Pattern } from '../lib/models/pattern';

@Injectable({
  providedIn: 'root'
})
export class PatternService {
  
  private readonly API_URL = 'https://raw.githubusercontent.com/ai-standards/ai-design-patterns/refs/heads/main/index.json';
  private http = inject(HttpClient);
  
  private index$ = this.http.get<PatternIndex>(this.API_URL);
  private patterns$ = this.index$.pipe(map(index => ([...index.patterns])));
  
  patterns = toSignal(this.patterns$);

  find(patternId: string): Promise<Pattern | undefined> {
    return firstValueFrom(this.patterns$.pipe(
      map(patterns => patterns?.find(p => p.id === patternId) || undefined)
    ))
  }

  load(patternId: string): Promise<Pattern | undefined> {
    return firstValueFrom(this.patterns$.pipe(
      switchMap(patterns => from(this.content(patternId)).pipe(
        map(content => {
          const pattern = patterns?.find(p => p.id === patternId) || undefined;
          if (! pattern) {
            throw new Error('Pattern not found: ' + patternId);
          }
          return {
            ...pattern,
            content
          }
        })
      ))
    ))
  }

  content(patternId: string) {
    return firstValueFrom(
      this.http.get(`https://raw.githubusercontent.com/ai-standards/ai-design-patterns/refs/heads/main/patterns/${patternId}/README.md`, { 
        responseType: 'text' 
      }).pipe(map(res => res.toString()))
    );
  }

  userStory(patternId: string) {
    return firstValueFrom(
      this.http.get(`https://raw.githubusercontent.com/ai-standards/ai-design-patterns/refs/heads/main/patterns/${patternId}/user-story.md`, { 
        responseType: 'text' 
      }).pipe(map(res => res.toString()))
    );
  }
}
