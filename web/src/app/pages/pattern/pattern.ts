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

@Component({
  selector: 'app-pattern',
  standalone: true,
  imports: [MarkdownComponent, MatCardModule, Layout, MatChip, MatButtonModule, RouterLink],
  templateUrl: './pattern.html',
  styleUrl: './pattern.scss'
})
export class Pattern implements OnInit, OnDestroy {
  readonly patternService = inject(PatternService); 
  readonly route = inject(ActivatedRoute);

  readonly pattern = signal<any>(undefined);
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
    const pattern = await this.patternService.find(id);
    this.pattern.set(pattern || undefined);

    // load story
    const story = await this.patternService.userStory(id);
    if (story) {
      const preview = story.split('\n').slice(1, 12).join('\n');
      this.userStoryPreview.set(preview);
    } else {
      this.userStoryPreview.set('')
    }
  }
}
