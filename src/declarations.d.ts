declare module '@daytona/sdk' {
  export class Daytona {
    constructor(config: any);
    create(params: any): Promise<any>;
    get(id: string): Promise<any>;
    remove(workspace: any): Promise<void>;
  }
}

declare module '@daytonaio/sdk' {
  export class Daytona {
    constructor(config: any);
    create(params: any): Promise<any>;
    get(id: string): Promise<any>;
    remove(workspace: any): Promise<void>;
  }
}
