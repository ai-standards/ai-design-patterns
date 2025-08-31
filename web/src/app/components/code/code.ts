import { HttpClient } from '@angular/common/http';
import { Component, inject, Input, OnInit, signal } from '@angular/core';
import { firstValueFrom, map, single } from 'rxjs';
import { MarkdownComponent } from "ngx-markdown";

@Component({
  selector: 'app-code',
  imports: [MarkdownComponent],
  templateUrl: './code.html',
  styleUrl: './code.scss'
})
export class Code implements OnInit {
  @Input() src!: string;

  readonly http = inject(HttpClient);

  readonly markdown = signal<string>('');

  async ngOnInit(): Promise<void> {
    const file = await firstValueFrom(this.http.get(this.src, { 
      responseType: 'text' 
    }).pipe(
      map(res => res.toString())
    ));

    const lines = [
      '```' + (this.src.endsWith('json') ? 'json' : 'typescript'),
      file,
      '```'
    ]
    
    this.markdown.set(lines.join(`\n`));
  }
}
