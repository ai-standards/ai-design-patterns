import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChip } from '@angular/material/chips';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MarkdownComponent } from 'ngx-markdown';
import { Layout } from '../../components/layout/layout';
import { Subscription, map } from 'rxjs';
import { PatternService } from '../../services/pattern';
import { MatIconModule } from '@angular/material/icon';
import { PatternTitlePipe } from "../../pipes/pattern-title-pipe";

@Component({
  selector: 'app-user-story',
  imports: [MarkdownComponent, MatCardModule, Layout, MatChip, MatButtonModule, RouterLink, MatIconModule, PatternTitlePipe],
  templateUrl: './user-story.html',
  styleUrl: './user-story.scss'
})
export class UserStory implements OnInit, OnDestroy {
  readonly patternService = inject(PatternService); 
  readonly route = inject(ActivatedRoute);

  readonly pattern = signal<any>(undefined);
  readonly userStory = signal<string>('')
  
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
    this.userStory.set(story);
  }
}