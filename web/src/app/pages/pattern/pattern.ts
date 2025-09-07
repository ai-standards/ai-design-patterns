import { Component, computed, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { PatternService } from '../../services/pattern';
import { ActivatedRoute, ActivatedRouteSnapshot, RouterLink } from '@angular/router';
import { map, Subscription } from 'rxjs';
import { MarkdownComponent } from "ngx-markdown";
import { MatCardModule } from '@angular/material/card';
import { Landing } from "../landing/landing";
import { Layout } from "../../components/layout/layout";
import { MatChip } from "@angular/material/chips";
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {MatGridListModule} from '@angular/material/grid-list';

@Component({
  selector: 'app-pattern',
  standalone: true,
  imports: [MarkdownComponent, MatCardModule, Layout, MatChip, MatButtonModule, RouterLink, MatIconModule, MatGridListModule],
  templateUrl: './pattern.html',
  styleUrl: './pattern.scss'
})
export class Pattern implements OnInit, OnDestroy {
  readonly patternService = inject(PatternService); 
  readonly route = inject(ActivatedRoute);

  readonly pattern = signal<any>(undefined);

  readonly lines = computed(() => {
    const pattern = this.pattern();
    console.log(pattern);
    if (! pattern) {
      return [];
    }
    return pattern.content.trim().split('\n') as string[];
  })

  readonly title = computed(() => {
    const idx = this.lines().findIndex(l => l.startsWith('## '));
    if (idx === -1) {
      return '';
    }
    return this.lines().slice(0, idx).join('\n');
  })

  readonly body = computed(() => {
    const idx = this.lines().findIndex(l => l.startsWith('## '));
    if (idx === -1) {
      return '';
    }
    return this.lines().slice(idx).join('\n');
  })

  readonly exampleFiles = signal<string[]>([]);

  readonly userStoryPreview = signal<string>('')
  
  private subscription?: Subscription;

  async ngOnInit(): Promise<void> {
    this.subscription = this.route.params.pipe(map(p => p['id'])).subscribe(id => this.loadPattern(id))
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  async loadPattern(id: string) {
    // load pattern
    const pattern = await this.patternService.load(id);
    this.pattern.set(pattern || undefined);

    // load example files
    const exampleFiles = pattern?.exampleFiles    
      .filter(file => file.startsWith('src/') && file.endsWith('.ts'))
      .map(file => file.split('/').pop() || file);
      
    this.exampleFiles.set(exampleFiles || [])

    // load story
    const story = await this.patternService.userStory(id);
    if (story) {
      const preview = story.split('\n').slice(0, 12).join('\n');
      this.userStoryPreview.set(preview);
    } else {
      this.userStoryPreview.set('')
    }
  }
}
