import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { PatternIndex } from '../lib/models/pattern';

@Injectable({
  providedIn: 'root'
})
export class PatternService {
  
  private readonly API_URL = 'https://raw.githubusercontent.com/ai-standards/ai-design-patterns/refs/heads/main/index.json';
  private http = inject(HttpClient);
  
  private index$ = this.http.get<PatternIndex>(this.API_URL);
  
  patterns = toSignal(this.index$.pipe(map(index => ([...index.patterns]))));
}
