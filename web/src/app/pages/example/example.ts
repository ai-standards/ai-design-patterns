import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, firstValueFrom, map } from 'rxjs';
import { PatternService } from '../../services/pattern';
import { MatCard, MatCardModule } from "@angular/material/card";
import { MatButtonModule } from '@angular/material/button';
import { MatChip } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MarkdownComponent } from 'ngx-markdown';
import { Layout } from '../../components/layout/layout';
import { PatternTitlePipe } from '../../pipes/pattern-title-pipe';
import {MatTabsModule} from '@angular/material/tabs';
import { Code } from "../../components/code/code";
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-example',
  imports: [MarkdownComponent, MatCardModule, Layout, MatChip, MatButtonModule, RouterLink, MatIconModule, PatternTitlePipe, MatTabsModule, Code],
  templateUrl: './example.html',
  styleUrl: './example.scss'
})
export class Example implements OnInit, OnDestroy {
  readonly patternService = inject(PatternService); 
  readonly route = inject(ActivatedRoute);
  readonly http = inject(HttpClient);

  readonly pattern = signal<any>(undefined);
  readonly exampleFiles = signal<any[]>([]);

  readonly intro = signal<string>('');
  readonly content = signal<string>('');
  
  private subscription?: Subscription;

  async ngOnInit(): Promise<void> {
    this.subscription = this.route.params.pipe(map(p => p['id'])).subscribe(id => this.loadPattern(id))
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  async loadPattern(id: string) {
    // load pattern
    const pattern = await this.patternService.find(id);
    this.pattern.set(pattern || undefined);
    if (! pattern) {
      this.exampleFiles.set([]);
      return;
    }

    const readme = await firstValueFrom(this.http.get(`https://raw.githubusercontent.com/ai-standards/ai-design-patterns/refs/heads/main/patterns/${pattern.id}/src/README.md`, { 
      responseType: 'text' 
    }).pipe(
      map(res => res.toString())
    ));

    // Split README on first line starting with '## '
    const lines = readme.split('\n');
    const splitIndex = lines.findIndex(line => line.startsWith('## '));
    
    if (splitIndex !== -1) {
      const introLines = lines.slice(0, splitIndex);
      const contentLines = lines.slice(splitIndex);
      
      this.intro.set(introLines.join('\n').trim());
      this.content.set(contentLines.join('\n').trim());
    } else {
      // If no '## ' found, put everything in intro
      this.intro.set(readme.trim());
      this.content.set('');
    }

    // load example files
    const exampleFiles = pattern?.exampleFiles    
      .filter(file => file.startsWith('src/') && file.endsWith('.ts'))
      .map(file => file.split('/').pop() || file);

    const fileTree: any[] = [
      {
        name: 'package.json',
        path: `https://raw.githubusercontent.com/ai-standards/ai-design-patterns/refs/heads/main/patterns/${pattern.id}/package.json`
      },
      ...exampleFiles.map(f => ({
        name: f,
        path: `https://raw.githubusercontent.com/ai-standards/ai-design-patterns/refs/heads/main/patterns/${pattern.id}/src/${f}`
      }))
    ];
      
    this.exampleFiles.set(fileTree)
  }
}